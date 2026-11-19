/**
 * Newsroom workflow for the EmDash admin: review requests, comments on
 * passages, approvals by named editors, and a gate that keeps an article from
 * going live until the exact text was approved. It also gives editors a review
 * queue, a dashboard card and an editorial calendar.
 *
 * The rules are in review.ts; this file connects them to EmDash.
 *
 * What is enforced, and where:
 *  - Who may do what is EmDash's own role check, declared per route
 *    (`permission`). The host rejects the request before this code runs.
 *  - Publishing and scheduling are blocked by the `content:beforePublish` and
 *    `content:beforeSchedule` hooks unless the approvals are in. EmDash calls
 *    them for the admin, the API and the scheduler alike.
 *  - Who may approve, and how many approvals are needed, come from the
 *    plugin's settings and are read each time, so changes apply at once.
 */
import { definePlugin } from "emdash";
import { portableTextBlocks } from "../rich/blocks.mjs";
import { portableTextToPlain } from "../rich/plain";
import { readHits, searchUrl } from "../rich/slack-search";
import type { SlackKind } from "../rich/slack-search";
import { findAnchor, type Anchor } from "./anchors";
import {
  approve,
  dayOf,
  fingerprint,
  newReview,
  noteEdit,
  policyFrom,
  publishBlock,
  requestChanges,
  reviewedCollections,
  ROLE,
  RuleError,
  submit,
  type Actor,
  type Policy,
  type Review,
  type ReviewComment,
} from "./review";
import {
  post,
  say as slackSay,
  whoAmI,
  type Article,
  type Person,
} from "./slack";

/** The fields a reviewer reads; an edit to any of them voids an approval. */
const REVIEWED_FIELDS = ["title", "excerpt", "body", "body_rich"] as const;

/** Collections the review panel and buttons can appear on. */
const PANEL_COLLECTIONS = ["posts", "changelogs", "pages"];

// The context types are EmDash's; the routes only need a few members.
// eslint-disable-next-line typescript-eslint/no-explicit-any
type Ctx = any;

const who = (ctx: Ctx): Actor & { name: string } => ({
  id: ctx.user?.id ?? "unknown",
  role: ctx.user?.role ?? 0,
  email: ctx.user?.email ?? undefined,
  name: ctx.user?.name ?? ctx.user?.email ?? "Someone",
});

/** The site's rules, read from settings each time. */
async function rules(ctx: Ctx): Promise<{
  policy: Policy;
  collections: string[];
  notify: boolean;
}> {
  const [requiredApprovals, approvers, collections, notify] = await Promise.all(
    [
      ctx.settings.get("requiredApprovals"),
      ctx.settings.get("approvers"),
      ctx.settings.get("collections"),
      ctx.settings.get("notify"),
    ],
  );
  return {
    policy: policyFrom({ requiredApprovals, approvers }),
    collections: reviewedCollections(collections),
    notify: notify !== false,
  };
}

async function loadReview(ctx: Ctx, entryId: string, collection: string) {
  const review =
    ((await ctx.storage.reviews.get(entryId)) as Review | null) ??
    newReview(entryId, collection);
  review.approvals ??= [];
  return review;
}

/**
 * Publish events carry the whole entry, with the article's fields under
 * `data`. Save events may carry the fields alone.
 */
function fieldsOf(content: Record<string, unknown>): Record<string, unknown> {
  const { data } = content;
  return data && typeof data === "object"
    ? (data as Record<string, unknown>)
    : content;
}

/**
 * The fields of an article as publishing would publish them. Edits to an
 * article with revisions are kept in its draft revision until then, not in
 * the entry itself, so that is where the saved text is.
 */
async function savedFields(
  ctx: Ctx,
  entry: { collection: string; id: string },
  item: { data: Record<string, unknown>; draftRevisionId?: string | null },
): Promise<Record<string, unknown>> {
  if (!item.draftRevisionId || !ctx.content.getRevision) return item.data;
  const draft = await ctx.content.getRevision(
    entry.collection,
    entry.id,
    item.draftRevisionId,
  );
  return draft?.data ? { ...item.data, ...draft.data } : item.data;
}

const pretty = (state: string) => state.replaceAll("_", " ");

function toast(message: string, type: "success" | "error" = "success") {
  return { toast: { message, type }, refresh: true as const };
}

async function guarded(run: () => Promise<unknown>) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof RuleError) return toast(error.message, "error");
    throw error;
  }
}

/** Sends an email if the site has a provider. A failure never blocks work. */
async function mail(
  ctx: Ctx,
  to: string | string[] | undefined,
  subject: string,
  text: string,
) {
  if (!ctx.email || !to) return;
  for (const address of [to].flat().filter((entry) => entry.includes("@"))) {
    try {
      await ctx.email.send({ to: address, subject, text });
    } catch (error) {
      ctx.log.warn("Could not send a review email", { error: String(error) });
    }
  }
}

const adminLink = (ctx: Ctx, collection: string, id: string) =>
  ctx.url(`/_emdash/admin/content/${collection}/${id}`);

/** The title as last saved, which for an edited article is in its draft. */
async function titleOf(ctx: Ctx, collection: string, id: string) {
  const item = await ctx.content.get(collection, id);
  if (!item) return id;
  const fields = await savedFields(ctx, { collection, id }, item);
  return String(fields.title ?? item.slug ?? id);
}

// ---------------------------------------------------------------------------
// Slack
//
// The newsroom channel gets one message per article, with the article's
// review as replies under it. A person gets a direct message when something
// needs them. Nothing here may fail the work that caused it.
// ---------------------------------------------------------------------------

/** Where an article's message is in the channel. */
type SlackThread = {
  channel?: string;
  ts?: string;
  /** When each person's suggestions were last announced, by user id. */
  nudged?: Record<string, string>;
};

/** Typing in suggesting mode saves often; the author hears of it this often. */
const SUGGESTION_QUIET_MS = 30 * 60 * 1000;

/**
 * How Slack is set up, from the plugin's settings. The token and the channel
 * fall back to the environment, so a deployment can set them once.
 */
type SlackConfig = {
  token?: string;
  channel?: string;
  /** Tell the channel about new drafts. */
  drafts: boolean;
  /** Tell the channel how each review goes. */
  review: boolean;
  /** Send people direct messages. */
  direct: boolean;
};

async function slackConfig(ctx: Ctx): Promise<SlackConfig> {
  // A secret that cannot be read (no encryption key) is the same as none.
  const read = (key: string) => ctx.settings.get(key).catch(() => undefined);
  const [token, channel, drafts, review, direct] = await Promise.all(
    [
      "slackToken",
      "slackChannel",
      "slackDrafts",
      "slackReview",
      "slackDirect",
    ].map(read),
  );
  const text = (value: unknown, fallback?: string) =>
    (typeof value === "string" ? value.trim() : "") ||
    fallback?.trim() ||
    undefined;
  return {
    token: text(token, process.env.SLACK_BOT_TOKEN),
    channel: text(channel, process.env.NEWSROOM_SLACK_CHANNEL),
    drafts: drafts !== false,
    review: review !== false,
    direct: direct !== false,
  };
}

/** Someone as Slack shows them. The Slack ID is kept at sign-in. */
async function personOf(ctx: Ctx, userId: string): Promise<Person> {
  const [user, known] = await Promise.all([
    ctx.users?.get(userId),
    ctx.storage.slackIds.get(userId),
  ]);
  return {
    name: user?.name ?? "Someone",
    slackId: (known as { slackId?: string } | null)?.slackId,
  };
}

async function articleOf(
  ctx: Ctx,
  collection: string,
  id: string,
  title?: unknown,
): Promise<Article> {
  return {
    title: String(title ?? "").trim() || (await titleOf(ctx, collection, id)),
    url: adminLink(ctx, collection, id),
  };
}

async function slackPost(
  ctx: Ctx,
  token: string,
  message: { channel: string; text: string; threadTs?: string },
) {
  return post(
    (url, init) => ctx.http.fetch(url, init),
    token,
    message,
    (reason) => ctx.log.warn("Slack refused a message", { reason }),
  );
}

/** Says something under the article's message, or starts that message. */
async function toChannel(
  ctx: Ctx,
  entryId: string,
  text: string,
  kind: "drafts" | "review" = "review",
) {
  try {
    const config = await slackConfig(ctx);
    if (!config.token || !config[kind]) return;
    const thread = (await ctx.storage.slack.get(entryId)) as SlackThread | null;
    const channel = thread?.channel ?? config.channel;
    if (!channel) return;
    const sent = await slackPost(ctx, config.token, {
      channel,
      text,
      threadTs: thread?.ts,
    });
    if (sent && !thread?.ts)
      await ctx.storage.slack.put(entryId, {
        ...thread,
        channel: sent.channel,
        ts: sent.ts,
      } satisfies SlackThread);
  } catch (error) {
    ctx.log.warn("Could not post to Slack", { error: String(error) });
  }
}

/** A direct message to each of these people, except whoever caused it. */
async function toPeople(
  ctx: Ctx,
  userIds: (string | null | undefined)[],
  actorId: string,
  text: string,
) {
  try {
    const { token, direct } = await slackConfig(ctx);
    if (!token || !direct) return;
    const ids = new Set(userIds.filter((id): id is string => Boolean(id)));
    ids.delete(actorId);
    for (const id of ids) {
      const { slackId } = await personOf(ctx, id);
      if (slackId) await slackPost(ctx, token, { channel: slackId, text });
    }
  } catch (error) {
    ctx.log.warn("Could not send a Slack message", { error: String(error) });
  }
}

/** The named approvers, as user ids. They are written as ids or emails. */
async function approverIds(ctx: Ctx, policy: Policy): Promise<string[]> {
  const ids: string[] = [];
  for (const entry of policy.approvers) {
    const user = entry.includes("@")
      ? await ctx.users?.getByEmail(entry)
      : await ctx.users?.get(entry);
    if (user) ids.push(user.id);
  }
  return ids;
}

/** Tells the channel about a draft someone has just started. */
async function announceDraft(
  ctx: Ctx,
  event: {
    collection: string;
    isNew: boolean;
    content: Record<string, unknown>;
    actor?: { id: string };
  },
) {
  try {
    if (!event.isNew || !PANEL_COLLECTIONS.includes(event.collection)) return;
    const id = String(event.content.id ?? "");
    if (!id) return;
    const author = String(event.content.authorId ?? event.actor?.id ?? "");
    await toChannel(
      ctx,
      id,
      slackSay.draft(
        await articleOf(
          ctx,
          event.collection,
          id,
          fieldsOf(event.content).title,
        ),
        await personOf(ctx, author),
      ),
      "drafts",
    );
  } catch (error) {
    ctx.log.warn("Could not announce a draft", { error: String(error) });
  }
}

// ---------------------------------------------------------------------------
// The review panel next to an article
// ---------------------------------------------------------------------------

async function panel(ctx: Ctx) {
  const { entry } = ctx.ui as {
    entry: { collection: string; id: string };
  };
  const actor = who(ctx);
  const { policy, collections, notify } = await rules(ctx);
  const input = ctx.input as {
    type: string;
    action_id?: string;
    value?: unknown;
    values?: Record<string, string>;
    draft?: { fields: Record<string, unknown> };
  };
  if (!(await levelOn(ctx, actor, entry.collection, entry.id)))
    return NO_ACCESS;
  // The text comments are about: the rich-text body when it has one.
  const draft = input.draft?.fields;
  const rich = portableTextToPlain(draft?.body_rich);
  const text = rich || String(draft?.body ?? "");

  if (!collections.includes(entry.collection))
    return {
      blocks: [
        {
          type: "context",
          text: "Review is not required for this collection. An administrator can turn it on in the plugin's settings.",
        },
      ],
    };

  // Every interaction answers with the panel as it is afterwards, so a change
  // shows up at once. `notice` is the toast that goes with it.
  let notice: { message: string; type: "success" | "error" } | undefined;
  const say = (message: string, type: "success" | "error" = "success") => {
    notice = { message, type };
  };

  // The panel has one form: a comment, which an editor can instead send to
  // the author as a request for changes.
  if (
    input.type === "form_submit" &&
    input.values &&
    input.action_id === "comment"
  ) {
    const values = input.values as Record<string, unknown>;
    const body = String(values.body ?? "").trim();
    const sendBack = values.send_back === true || values.send_back === "true";
    if (sendBack) {
      try {
        const review = await loadReview(ctx, entry.id, entry.collection);
        const item = await ctx.content.get(entry.collection, entry.id);
        requestChanges(review, actor, body, item?.authorId);
        await ctx.storage.reviews.put(entry.id, review);
        say("Changes requested.");
        const about = await articleOf(ctx, entry.collection, entry.id);
        const text = slackSay.changesRequested(
          about,
          await personOf(ctx, actor.id),
          body,
        );
        await toChannel(ctx, entry.id, text);
        await toPeople(
          ctx,
          [review.submittedBy, item?.authorId],
          actor.id,
          text,
        );
        if (notify)
          await mail(
            ctx,
            review.submitterEmail,
            `Changes requested: ${await titleOf(ctx, entry.collection, entry.id)}`,
            `${actor.name} asked for changes:\n\n${body}\n\n${adminLink(ctx, entry.collection, entry.id)}`,
          );
      } catch (error) {
        if (!(error instanceof RuleError)) throw error;
        say(error.message, "error");
      }
    } else if (!body) say("Write a comment first.", "error");
    else {
      const comment: ReviewComment = {
        entryId: entry.id,
        author: actor.id,
        authorName: actor.name,
        at: new Date().toISOString(),
        quote: "",
        body,
        resolved: false,
        replies: [],
      };
      await ctx.storage.comments.put(crypto.randomUUID(), comment);
      say("Comment added.");
      const item = await ctx.content.get(entry.collection, entry.id);
      await toPeople(
        ctx,
        [item?.authorId],
        actor.id,
        slackSay.comment(
          await articleOf(ctx, entry.collection, entry.id),
          await personOf(ctx, actor.id),
          body,
          "",
        ),
      );
    }
  }

  if (input.type === "block_action" && input.action_id === "resolve") {
    const id = String(input.value);
    const comment = (await ctx.storage.comments.get(id)) as ReviewComment;
    if (comment && comment.entryId === entry.id) {
      comment.resolved = !comment.resolved;
      comment.resolvedBy = comment.resolved ? actor.id : undefined;
      await ctx.storage.comments.put(id, comment);
      say(comment.resolved ? "Resolved." : "Reopened.");
    }
  }

  const review = await loadReview(ctx, entry.id, entry.collection);
  const { items } = await ctx.storage.comments.query({
    where: { entryId: entry.id },
    limit: 100,
  });
  type CommentRow = ReviewComment & { id: string };
  const comments: CommentRow[] = items.map(
    (item: { id: string; data: ReviewComment }) => ({
      id: item.id,
      ...item.data,
    }),
  );
  comments.sort((a: ReviewComment, b: ReviewComment) =>
    a.at.localeCompare(b.at),
  );
  const open = comments.filter((c: ReviewComment) => !c.resolved);

  const blocks: unknown[] = [
    {
      type: "fields",
      fields: [
        { label: "Status", value: pretty(review.state) },
        {
          label: "Approvals",
          value: `${review.state === "approved" ? policy.required : review.approvals.length} of ${policy.required}`,
        },
        { label: "Open comments", value: String(open.length) },
        ...(policy.approvers.length
          ? [{ label: "Approvers", value: policy.approvers.join(", ") }]
          : []),
      ],
    },
  ];
  const lastNote = [...review.history]
    .reverse()
    .find((event) => event.action === "changes_requested");
  if (review.state === "changes_requested" && lastNote?.note)
    blocks.push({
      type: "banner",
      title: "Changes requested",
      description: lastNote.note,
      variant: "alert",
    });
  if (review.state === "approved")
    blocks.push({
      type: "banner",
      title: "Approved",
      description:
        "Any edit sends this article back to review. It can now be published.",
    });

  const drawn = (comment: CommentRow) => {
    const found =
      comment.quote || comment.kind === "suggestion"
        ? findAnchor(text, {
            quote: comment.quote,
            prefix: comment.prefix ?? "",
            suffix: comment.suffix ?? "",
            start: comment.start ?? 0,
          })
        : undefined;
    const line = found ? text.slice(0, found.start).split("\n").length : 0;
    const when = new Date(comment.at).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    const suggestion = comment.kind === "suggestion";
    const state =
      suggestion && comment.status !== "open" ? ` · ${comment.status}` : "";
    const lines: unknown[] = [
      {
        type: "context",
        text: `${suggestion ? "Suggestion" : "Comment"} by ${comment.authorName} · ${when}${line ? ` · line ${line}` : ""}${state}`,
      },
    ];
    if (comment.quote)
      lines.push({
        type: "context",
        text: `“${comment.quote.slice(0, 160)}”${
          text && !found ? " (text has changed)" : ""
        }`,
      });
    if (suggestion)
      lines.push({
        type: "section",
        text: !comment.quote
          ? `Add: “${(comment.replacement ?? "").slice(0, 200)}”`
          : comment.replacement
            ? `Change to: “${comment.replacement.slice(0, 200)}”`
            : "Delete this passage.",
      });
    if (comment.body) lines.push({ type: "section", text: comment.body });
    for (const reply of comment.replies)
      lines.push({
        type: "section",
        text: `${reply.authorName}: ${reply.body}`,
      });
    if (suggestion && comment.status === "open")
      lines.push({
        type: "context",
        text: "Open the passage in the text to accept or reject it.",
      });
    else
      lines.push({
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: "resolve",
            label: comment.resolved ? "Reopen" : "Resolve",
            value: comment.id,
          },
        ],
      });
    return lines;
  };

  for (const comment of open)
    blocks.push({ type: "divider" }, ...drawn(comment));
  const resolved = comments.filter((c: ReviewComment) => c.resolved);
  if (resolved.length)
    blocks.push({
      type: "accordion",
      label: `Resolved (${resolved.length})`,
      blocks: resolved.flatMap((c: CommentRow) => [
        { type: "divider" },
        ...drawn(c),
      ]),
    });

  // One box. Comments on a passage, replies and suggestions are made in the
  // text itself, where the passage is.
  const mayDecide = actor.role >= ROLE.EDITOR && review.state === "in_review";
  blocks.push(
    { type: "divider" },
    {
      type: "form",
      fields: [
        {
          type: "text_input",
          action_id: "body",
          label: "Comment",
          multiline: true,
        },
        ...(mayDecide
          ? [
              {
                type: "toggle",
                action_id: "send_back",
                label: "Request changes: send it back to the author",
              },
            ]
          : []),
      ],
      submit: { label: mayDecide ? "Send" : "Comment", action_id: "comment" },
    },
  );

  // Each event is its own line: Block Kit text does not keep line breaks.
  if (review.history.length)
    blocks.push(
      { type: "divider" },
      ...review.history.map((event) => ({
        type: "context",
        text: `${event.at.slice(0, 16).replace("T", " ")} · ${pretty(event.action)}${event.note ? ` (${event.note})` : ""}`,
      })),
    );

  return notice ? { blocks, toast: notice } : { blocks };
}

// ---------------------------------------------------------------------------
// Threads in the article's text
// ---------------------------------------------------------------------------

type ThreadInput = {
  op: "list" | "create" | "reply" | "resolve" | "decide" | "sync";
  collection: string;
  entryId: string;
  id?: string;
  kind?: "comment" | "suggestion";
  anchor?: Anchor;
  body?: string;
  replacement?: string;
  accept?: boolean;
  /** For sync: every change the writer has made in suggesting mode. */
  changes?: (Anchor & { replacement: string })[];
};

const MAX_PASSAGE = 4000;
const MAX_TEXT = 8000;

/** Search Slack people or channels by name, for the insert forms. */
async function slackSearch(ctx: Ctx) {
  const input = ctx.input as { kind?: string; q?: string };
  const kind: SlackKind | undefined =
    input.kind === "users" || input.kind === "channels"
      ? input.kind
      : undefined;
  const query = (input.q ?? "").trim().slice(0, 60);
  if (!kind || !query) return { hits: [] };
  try {
    const response = await ctx.http.fetch(searchUrl(kind, query), {
      headers: { Accept: "application/json" },
    });
    if (!response.ok)
      return { hits: [], error: "Slack search is unavailable." };
    return { hits: readHits(kind, await response.json()) };
  } catch {
    return { hits: [], error: "Slack search is unavailable." };
  }
}

/**
 * The editor's side of comments and suggestions: the text editor lists the
 * threads of an article and adds to them. The same threads show in the Review
 * panel. Accepting a suggestion only records the decision; the editor makes
 * the change in the text, which the author then saves.
 */
async function threads(ctx: Ctx) {
  const input = ctx.input as ThreadInput;
  const actor = who(ctx);
  const { collections } = await rules(ctx);
  if (!input.entryId || !collections.includes(input.collection))
    return { error: "Review is not turned on for this collection." };
  if (!(await levelOn(ctx, actor, input.collection, input.entryId)))
    return { error: "You do not have access to this article." };

  const fail = (error: string) => ({ error });
  const all = async () => {
    const { items } = await ctx.storage.comments.query({
      where: { entryId: input.entryId },
      limit: 500,
    });
    return items
      .map((item: { id: string; data: ReviewComment }) => ({
        id: item.id,
        ...item.data,
      }))
      .sort((a: ReviewComment, b: ReviewComment) => a.at.localeCompare(b.at));
  };
  const view = async () => ({
    threads: await all(),
    you: { id: actor.id, role: actor.role },
  });

  if (input.op === "list") return view();

  // Who hears about it on Slack.
  const ownerId = async (): Promise<string | undefined> =>
    (await ctx.content.get(input.collection, input.entryId))?.authorId;
  const about = () => articleOf(ctx, input.collection, input.entryId);
  const me = () => personOf(ctx, actor.id);
  /** Tells the author that this person is suggesting edits, but not often. */
  const nudge = async () => {
    const owner = await ownerId();
    const { token, direct } = await slackConfig(ctx);
    if (!token || !direct || !owner || owner === actor.id) return;
    const thread =
      ((await ctx.storage.slack.get(input.entryId)) as SlackThread | null) ??
      {};
    const last = Date.parse(thread.nudged?.[actor.id] ?? "");
    if (Date.now() - last < SUGGESTION_QUIET_MS) return;
    await ctx.storage.slack.put(input.entryId, {
      ...thread,
      nudged: { ...thread.nudged, [actor.id]: new Date().toISOString() },
    } satisfies SlackThread);
    await toPeople(
      ctx,
      [owner],
      actor.id,
      slackSay.suggested(await about(), await me()),
    );
  };

  if (actor.role < ROLE.AUTHOR)
    return fail("You cannot comment on this article.");

  const stored = async () => {
    const row = (await ctx.storage.comments.get(
      String(input.id ?? ""),
    )) as ReviewComment | null;
    return row && row.entryId === input.entryId ? row : null;
  };
  const body = String(input.body ?? "")
    .trim()
    .slice(0, MAX_TEXT);

  if (input.op === "create") {
    const anchor = input.anchor;
    const kind = input.kind === "suggestion" ? "suggestion" : "comment";
    // A suggestion may add text without quoting any; a comment needs a passage.
    const insertion =
      kind === "suggestion" && !anchor?.quote && Boolean(input.replacement);
    if (
      !anchor ||
      (!anchor.quote && !insertion) ||
      anchor.quote.length > MAX_PASSAGE
    )
      return fail("Select a passage first.");
    if (kind === "comment" && !body) return fail("Write a comment first.");
    const row: ReviewComment = {
      entryId: input.entryId,
      author: actor.id,
      authorName: actor.name,
      at: new Date().toISOString(),
      quote: anchor.quote,
      prefix: String(anchor.prefix ?? "").slice(0, 200),
      suffix: String(anchor.suffix ?? "").slice(0, 200),
      start: Number.isFinite(anchor.start) ? anchor.start : 0,
      kind,
      body,
      resolved: false,
      replies: [],
      ...(kind === "suggestion"
        ? {
            replacement: String(input.replacement ?? "").slice(0, MAX_TEXT),
            status: "open" as const,
          }
        : {}),
    };
    await ctx.storage.comments.put(crypto.randomUUID(), row);
    if (kind === "suggestion") await nudge();
    else
      await toPeople(
        ctx,
        [await ownerId()],
        actor.id,
        slackSay.comment(await about(), await me(), body, anchor.quote),
      );
    return view();
  }

  if (input.op === "sync") {
    // Suggesting mode: the writer's changes become the open suggestions
    // they made by typing. Unchanged ones keep their thread; ones the writer
    // took back are removed.
    const wanted = (Array.isArray(input.changes) ? input.changes : [])
      .slice(0, 200)
      .filter(
        (c) =>
          c &&
          (c.quote || c.replacement) &&
          String(c.quote ?? "").length <= MAX_PASSAGE &&
          String(c.replacement ?? "").length <= MAX_TEXT,
      );
    const mine = (await all()).filter(
      (r: ReviewComment & { id: string }) =>
        r.auto && r.author === actor.id && r.status === "open",
    );
    let made = false;
    for (const change of wanted) {
      const quote = String(change.quote ?? "");
      const replacement = String(change.replacement ?? "");
      const at = mine.findIndex(
        (r: ReviewComment) =>
          r.quote === quote && r.replacement === replacement,
      );
      const fields = {
        prefix: String(change.prefix ?? "").slice(0, 200),
        suffix: String(change.suffix ?? "").slice(0, 200),
        start: Number.isFinite(change.start) ? change.start : 0,
      };
      if (at >= 0) {
        const [kept] = mine.splice(at, 1);
        const { id, ...data } = kept;
        await ctx.storage.comments.put(id, { ...data, ...fields });
      } else {
        made = true;
        await ctx.storage.comments.put(crypto.randomUUID(), {
          entryId: input.entryId,
          author: actor.id,
          authorName: actor.name,
          at: new Date().toISOString(),
          quote,
          replacement,
          ...fields,
          kind: "suggestion",
          auto: true,
          status: "open",
          body: "",
          resolved: false,
          replies: [],
        } satisfies ReviewComment);
      }
    }
    for (const gone of mine) await ctx.storage.comments.delete(gone.id);
    if (made) await nudge();
    return view();
  }

  const row = await stored();
  if (!row) return fail("That thread no longer exists.");
  const id = String(input.id);

  if (input.op === "reply") {
    if (!body) return fail("Write a reply first.");
    row.replies.push({
      author: actor.id,
      authorName: actor.name,
      at: new Date().toISOString(),
      body,
    });
    // Everyone in the thread, and the article's author.
    await toPeople(
      ctx,
      [row.author, ...row.replies.map((r) => r.author), await ownerId()],
      actor.id,
      slackSay.reply(await about(), await me(), body),
    );
  } else if (input.op === "resolve") {
    if (row.kind === "suggestion" && row.status === "open")
      return fail("Accept or reject the suggestion instead.");
    row.resolved = !row.resolved;
    row.resolvedBy = row.resolved ? actor.id : undefined;
  } else if (input.op === "decide") {
    if (row.kind !== "suggestion" || row.status !== "open")
      return fail("This suggestion was already decided.");
    // Editors decide, and so does the article's author on their own article.
    const item = await ctx.content.get(input.collection, input.entryId);
    const owner = item?.authorId === actor.id;
    if (actor.role < ROLE.EDITOR && !owner)
      return fail("Only an editor or the article's author can decide.");
    row.status = input.accept ? "accepted" : "rejected";
    row.resolved = true;
    row.resolvedBy = actor.id;
    await toPeople(
      ctx,
      [row.author],
      actor.id,
      slackSay.decided(
        await about(),
        await me(),
        Boolean(input.accept),
        row.quote || row.replacement || "",
      ),
    );
  } else return fail("Unknown request.");

  await ctx.storage.comments.put(id, row);
  return view();
}

// ---------------------------------------------------------------------------
// Toolbar actions
// ---------------------------------------------------------------------------

/**
 * Fingerprints the saved article, not whatever is in the editor's unsaved
 * draft: an approval has to cover what publishing would publish.
 */
async function snapshot(ctx: Ctx) {
  const { entry } = ctx.ui as { entry: { collection: string; id: string } };
  const item = await ctx.content.get(entry.collection, entry.id);
  if (!item) throw new RuleError("This article was not found.");
  return {
    entry,
    item,
    hash: await fingerprint(
      await savedFields(ctx, entry, item),
      REVIEWED_FIELDS,
    ),
  };
}

async function submitAction(ctx: Ctx) {
  return guarded(async () => {
    const { entry, item } = await snapshot(ctx);
    const { policy, collections, notify } = await rules(ctx);
    if (!collections.includes(entry.collection))
      throw new RuleError("Review is not required for this collection.");
    const review = await loadReview(ctx, entry.id, entry.collection);
    submit(review, who(ctx));
    await ctx.storage.reviews.put(entry.id, review);
    const text = slackSay.submitted(
      await articleOf(ctx, entry.collection, entry.id),
      await personOf(ctx, who(ctx).id),
    );
    await toChannel(ctx, entry.id, text);
    await toPeople(ctx, await approverIds(ctx, policy), who(ctx).id, text);
    if (notify)
      await mail(
        ctx,
        policy.approvers,
        `Review wanted: ${String(item.data.title ?? entry.id)}`,
        `${who(ctx).name} sent an article for review.\n\n${adminLink(ctx, entry.collection, entry.id)}`,
      );
    return toast("Sent for review.");
  });
}

async function approveAction(ctx: Ctx) {
  return guarded(async () => {
    const { entry, item, hash } = await snapshot(ctx);
    const { policy, notify } = await rules(ctx);
    const review = await loadReview(ctx, entry.id, entry.collection);
    approve(review, who(ctx), hash, item.authorId, policy);
    await ctx.storage.reviews.put(entry.id, review);
    const about = await articleOf(ctx, entry.collection, entry.id);
    const me = await personOf(ctx, who(ctx).id);
    if (review.state === "approved") {
      const text = slackSay.approved(about, me);
      await toChannel(ctx, entry.id, text);
      await toPeople(
        ctx,
        [review.submittedBy, item.authorId],
        who(ctx).id,
        text,
      );
      if (notify)
        await mail(
          ctx,
          review.submitterEmail,
          `Approved: ${String(item.data.title ?? entry.id)}`,
          `It can now be published.\n\n${adminLink(ctx, entry.collection, entry.id)}`,
        );
      return toast("Approved. The article can be published.");
    }
    await toChannel(
      ctx,
      entry.id,
      slackSay.approvalRecorded(
        about,
        me,
        review.approvals.length,
        policy.required,
      ),
    );
    return toast(
      `Approval recorded: ${review.approvals.length} of ${policy.required}.`,
    );
  });
}

// ---------------------------------------------------------------------------
// Review queue, dashboard card and editorial calendar
// ---------------------------------------------------------------------------

type Row = { id: string; data: Review };

async function reviewsIn(ctx: Ctx, state: Review["state"]): Promise<Row[]> {
  const { items } = await ctx.storage.reviews.query({
    where: { state },
    limit: 100,
  });
  // Reviews saved before approvals were counted have no list.
  for (const row of items as Row[]) row.data.approvals ??= [];
  return items;
}

async function queue(ctx: Ctx) {
  const actor = who(ctx);
  const { policy } = await rules(ctx);
  const waiting = await reviewsIn(ctx, "in_review");
  const returned = await reviewsIn(ctx, "changes_requested");
  const blocks: unknown[] = [
    {
      type: "stats",
      items: [
        { label: "Waiting for review", value: waiting.length },
        { label: "Returned to authors", value: returned.length },
        { label: "Approvals needed", value: policy.required },
      ],
    },
  ];
  const list = async (title: string, rows: Row[]) => {
    blocks.push({ type: "header", text: title });
    if (!rows.length) {
      blocks.push({ type: "context", text: "Nothing here." });
      return;
    }
    for (const { id, data } of rows) {
      const name = await titleOf(ctx, data.collection, id);
      const mine = data.approvals.some((entry) => entry.by === actor.id);
      blocks.push(
        {
          type: "section",
          text: `${name}\n${pretty(data.state)} · ${data.approvals.length} of ${policy.required} approvals${mine ? " · you approved" : ""}`,
        },
        {
          type: "actions",
          elements: [
            {
              type: "link",
              label: "Open",
              target: { kind: "content", collection: data.collection, id },
            },
          ],
        },
      );
    }
  };
  await list("Waiting for review", waiting);
  await list("Returned to authors", returned);
  return { blocks };
}

async function widget(ctx: Ctx) {
  const { policy } = await rules(ctx);
  const waiting = await reviewsIn(ctx, "in_review");
  const actor = who(ctx);
  const mine = waiting.filter(
    (row) => !row.data.approvals.some((entry) => entry.by === actor.id),
  );
  return {
    blocks: [
      {
        type: "stats",
        items: [
          { label: "Awaiting review", value: waiting.length },
          { label: "Waiting for you", value: mine.length },
          { label: "Approvals needed", value: policy.required },
        ],
      },
    ],
  };
}

async function calendar(ctx: Ctx) {
  const { collections } = await rules(ctx);
  const today = new Date().toISOString();
  const rows: { at: string; what: string; title: string }[] = [];
  for (const collection of collections) {
    const { items } = await ctx.content.list(collection, {
      limit: 200,
      orderBy: { updatedAt: "desc" },
    });
    for (const item of items as {
      data: Record<string, unknown>;
      slug: string | null;
      scheduledAt?: string | null;
      publishedAt: string | null;
      status: string;
    }[]) {
      const title = String(item.data.title ?? item.slug ?? "Untitled");
      if (item.scheduledAt && item.scheduledAt >= today)
        rows.push({ at: item.scheduledAt, what: "Goes live", title });
      if (item.publishedAt && item.publishedAt >= today.slice(0, 10))
        rows.push({ at: item.publishedAt, what: "Published", title });
    }
  }
  rows.sort((a, b) => a.at.localeCompare(b.at));
  if (!rows.length)
    return {
      blocks: [
        { type: "header", text: "Editorial calendar" },
        {
          type: "context",
          text: "Nothing is scheduled to go live.",
        },
      ],
    };
  return {
    blocks: [
      { type: "header", text: "Editorial calendar" },
      {
        type: "table",
        columns: [
          { key: "day", label: "Day" },
          { key: "what", label: "What", format: "badge" },
          { key: "title", label: "Article" },
        ],
        rows: rows.map((row) => ({
          day: dayOf(row.at),
          what: row.what,
          title: row.title,
        })),
        page_action_id: "calendar-page",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Who may touch an article
//
// Editors and up work on everything. Everyone below them is a submitter: an
// outside contributor who works only on articles they own, or that they were
// added to as a collaborator. src/cms/newsroom/submitters.ts holds EmDash's
// own API to the same rule; this is the rule for the plugin's routes.
// ---------------------------------------------------------------------------

type Level = "editor" | "owner" | "collaborator";
/** One row for each person added to an article, keyed `<entry>:<user>`. */
type Collaborator = { entryId: string; userId: string; addedBy: string };

async function levelOn(
  ctx: Ctx,
  actor: Actor,
  collection: string,
  entryId: string,
): Promise<Level | null> {
  if (actor.role >= ROLE.EDITOR) return "editor";
  const item = await ctx.content.get(collection, entryId);
  if (!item) return null;
  if (item.authorId === actor.id) return "owner";
  const row = await ctx.storage.collaborators.get(`${entryId}:${actor.id}`);
  return row ? "collaborator" : null;
}

const NO_ACCESS = {
  blocks: [
    { type: "context", text: "You do not have access to this article." },
  ],
};

/** The sidebar's Collaborators section: who else may read and comment. */
async function people(ctx: Ctx) {
  const { entry } = ctx.ui as { entry: { collection: string; id: string } };
  const actor = who(ctx);
  const level = await levelOn(ctx, actor, entry.collection, entry.id);
  if (!level) return NO_ACCESS;
  const manage = level === "editor" || level === "owner";
  const input = ctx.input as {
    type: string;
    action_id?: string;
    value?: unknown;
    values?: Record<string, unknown>;
  };
  let notice: { message: string; type: "success" | "error" } | undefined;

  if (manage && input.type === "form_submit" && input.action_id === "add") {
    const email = String(input.values?.email ?? "")
      .trim()
      .toLowerCase();
    const found = email ? await ctx.users?.getByEmail(email) : null;
    if (!found)
      notice = {
        message: "Nobody with that email has signed in to the newsroom yet.",
        type: "error",
      };
    else {
      const row: Collaborator = {
        entryId: entry.id,
        userId: found.id,
        addedBy: actor.id,
      };
      await ctx.storage.collaborators.put(`${entry.id}:${found.id}`, row);
      notice = { message: "Added.", type: "success" };
      await toPeople(
        ctx,
        [found.id],
        actor.id,
        slackSay.added(
          await articleOf(ctx, entry.collection, entry.id),
          await personOf(ctx, actor.id),
        ),
      );
    }
  }
  if (manage && input.type === "block_action" && input.action_id === "remove") {
    await ctx.storage.collaborators.delete(
      `${entry.id}:${String(input.value)}`,
    );
    notice = { message: "Removed.", type: "success" };
  }

  const { items } = await ctx.storage.collaborators.query({
    where: { entryId: entry.id },
    limit: 50,
  });
  const blocks: unknown[] = [
    {
      type: "context",
      text: "Collaborators can read this article, comment on it and suggest edits. Only its author and editors can change the text.",
    },
  ];
  for (const { data } of items as { data: Collaborator }[]) {
    const user = await ctx.users?.get(data.userId);
    blocks.push({
      type: "section",
      text: user?.name ?? user?.email ?? data.userId,
    });
    if (manage)
      blocks.push({
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: "remove",
            label: "Remove",
            value: data.userId,
          },
        ],
      });
  }
  if (!items.length) blocks.push({ type: "context", text: "Nobody yet." });
  if (manage)
    blocks.push({
      type: "form",
      fields: [
        { type: "text_input", action_id: "email", label: "Add by email" },
      ],
      submit: { label: "Add", action_id: "add" },
    });
  return notice ? { blocks, toast: notice } : { blocks };
}

/** The "Shared with me" page: articles the reader was added to. */
async function shared(ctx: Ctx) {
  const actor = who(ctx);
  const { items } = await ctx.storage.collaborators.query({
    where: { userId: actor.id },
    limit: 100,
  });
  const blocks: unknown[] = [{ type: "header", text: "Shared with me" }];
  for (const { data } of items as { data: Collaborator }[]) {
    const { collections } = await rules(ctx);
    for (const collection of collections) {
      const item = await ctx.content.get(collection, data.entryId);
      if (!item) continue;
      blocks.push(
        {
          type: "section",
          text: String(item.data.title ?? item.slug ?? "Untitled"),
        },
        {
          type: "actions",
          elements: [
            {
              type: "link",
              label: "Open",
              target: { kind: "content", collection, id: data.entryId },
            },
          ],
        },
      );
      break;
    }
  }
  if (blocks.length === 1)
    blocks.push({
      type: "context",
      text: "Nothing has been shared with you. Your own articles are under Posts.",
    });
  return { blocks };
}

/** Blocks a submitter may not put in an article: they put raw HTML on the site. */
const UNSAFE_BLOCKS = new Set(["snRawHtml", "htmlBlock", "html"]);

/**
 * What a submitter's save may hold. They write in the rich-text body only:
 * the MDX body is code that runs on the server, and raw HTML runs in every
 * reader's browser, so neither is theirs to set.
 */
function submitterFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...fields };
  delete out.body;
  out.body_format = "rich";
  if (typeof out.body_rich === "string") {
    try {
      out.body_rich = JSON.parse(out.body_rich);
    } catch {
      out.body_rich = [];
    }
  }
  if (Array.isArray(out.body_rich))
    out.body_rich = out.body_rich.filter(
      (block) =>
        !UNSAFE_BLOCKS.has(String((block as { _type?: unknown })?._type)),
    );
  return out;
}

/**
 * The administrators' Slack page: whether the bot is connected, and buttons
 * to try it. The token and channel themselves are in the plugin's settings.
 */
async function slackPage(ctx: Ctx) {
  const actor = who(ctx);
  if (actor.role < ROLE.ADMIN)
    return {
      blocks: [{ type: "context", text: "This page is for administrators." }],
    };
  const input = ctx.input as { type?: string; action_id?: string };
  const config = await slackConfig(ctx);
  const fetcher = (url: string, init?: RequestInit) =>
    ctx.http.fetch(url, init);
  const me = await personOf(ctx, actor.id);
  let notice: { message: string; type: "success" | "error" } | undefined;

  if (input.type === "block_action" && config.token) {
    const target =
      input.action_id === "test_channel"
        ? config.channel
        : input.action_id === "test_me"
          ? (me.slackId ?? undefined)
          : undefined;
    if (target) {
      let reason = "";
      const sent = await post(
        fetcher,
        config.token,
        {
          channel: target,
          text: `Test from Slacker Newsroom, sent by ${actor.name}.`,
        },
        (why) => {
          reason = why;
        },
      );
      notice = sent
        ? { message: "Sent. Look in Slack.", type: "success" }
        : { message: `Slack refused it: ${reason}`, type: "error" };
    }
  }

  const bot = config.token ? await whoAmI(fetcher, config.token) : undefined;
  const blocks: unknown[] = [
    { type: "header", text: "Slack" },
    {
      type: "fields",
      fields: [
        {
          label: "Bot",
          value: !bot
            ? "No token"
            : bot.error
              ? `Not connected (${bot.error})`
              : `${bot.bot} in ${bot.workspace}`,
        },
        { label: "Channel", value: config.channel ?? "Not set" },
        {
          label: "New drafts to the channel",
          value: config.drafts ? "On" : "Off",
        },
        { label: "Review to the channel", value: config.review ? "On" : "Off" },
        { label: "Direct messages", value: config.direct ? "On" : "Off" },
        {
          label: "Your Slack ID",
          value: me.slackId ?? "Unknown. Sign out and in again.",
        },
      ],
    },
    {
      type: "context",
      text: "Set the bot token, the channel and what is sent in Plugins, Newsroom, Settings. The bot needs the chat:write scope, and must be in the channel or have chat:write.public. People get direct messages once they have signed in with Hack Club, which is where their Slack ID comes from.",
    },
  ];
  if (bot && !bot.error) {
    const buttons: unknown[] = [];
    if (config.channel)
      buttons.push({
        type: "button",
        action_id: "test_channel",
        label: "Send a test to the channel",
      });
    if (me.slackId)
      buttons.push({
        type: "button",
        action_id: "test_me",
        label: "Send a test to me",
      });
    if (buttons.length) blocks.push({ type: "actions", elements: buttons });
  }
  return notice ? { blocks, toast: notice } : { blocks };
}

async function admin(ctx: Ctx) {
  const { page } = ctx.input as { page?: string };
  if (page === "/shared") return shared(ctx);
  if (page === "/slack") return slackPage(ctx);
  // The queue, the calendar and the dashboard card are the editors'.
  if (who(ctx).role < ROLE.EDITOR)
    return { blocks: [{ type: "context", text: "This page is for editors." }] };
  if (page === "widget:awaiting") return widget(ctx);
  if (page === "/calendar") return calendar(ctx);
  return queue(ctx);
}

// ---------------------------------------------------------------------------
// Articles used to have an "Expires" date, checked by an hourly task. The date
// is gone; this takes the task off sites that still have it.
// ---------------------------------------------------------------------------

async function retireExpiry(ctx: Ctx) {
  try {
    await ctx.cron.cancel("expire");
  } catch {
    // Nothing was scheduled.
  }
}

// ---------------------------------------------------------------------------

export function createPlugin() {
  return definePlugin({
    id: "newsroom",
    version: "0.2.0",
    allowedHosts: ["flaron.halceon.dev", "slack.com"],
    capabilities: [
      "content:read",
      // Unpublished edits are kept in a draft revision; an approval has to
      // cover that text, so the plugin reads it.
      "content:revisions:read",
      "content:write",
      // Collaborators are added by email and shown by name.
      "users:read",
      "content:publish",
      "email:send",
      "hooks.content-policy:register",
      // Slack people and channels are looked up on Flaron for the insert forms,
      // and Slack is told about drafts and reviews.
      "network:request",
      // The review panel reads the unsaved text, to find quoted passages.
      "admin.editor-draft:read",
    ],
    storage: {
      reviews: { indexes: ["state", "collection"] },
      comments: { indexes: ["entryId", "resolved"] },
      collaborators: { indexes: ["entryId", "userId"] },
      // Where each article's message is in the Slack channel.
      slack: { indexes: [] },
      // Each person's Slack ID, written when they sign in with Hack Club.
      slackIds: { indexes: [] },
    },
    admin: {
      settingsSchema: {
        collections: {
          type: "string",
          label: "Collections that need review",
          description:
            "Comma-separated collection slugs. Posts, changelogs and pages are supported.",
          default: "posts",
        },
        requiredApprovals: {
          type: "number",
          label: "Approvals needed",
          description:
            "How many different editors must approve before publishing (1 to 5).",
          default: 1,
          min: 1,
          max: 5,
        },
        approvers: {
          type: "string",
          label: "Approvers",
          description:
            "Emails or user IDs, separated by commas. Leave empty to let any editor approve. Administrators can always approve.",
          multiline: true,
        },
        notify: {
          type: "boolean",
          label: "Send email",
          description:
            "Tell approvers when an article is sent for review, and the author when it is decided. Needs an email provider.",
          default: true,
        },
        slackToken: {
          type: "secret",
          label: "Slack bot token",
          description:
            "The bot token of a Slack app (xoxb-…) with the chat:write scope. Empty uses SLACK_BOT_TOKEN from the environment. Without either, nothing is sent to Slack.",
        },
        slackChannel: {
          type: "string",
          label: "Slack channel",
          description:
            "The ID of the channel that hears about drafts and their review, such as C0123ABCDEF (in Slack: channel details, at the bottom). The bot must be in it, or have chat:write.public. Empty uses NEWSROOM_SLACK_CHANNEL.",
        },
        slackDrafts: {
          type: "boolean",
          label: "Slack: new drafts",
          description: "Post each new draft to the channel, with a link.",
          default: true,
        },
        slackReview: {
          type: "boolean",
          label: "Slack: review in the channel",
          description:
            "Post each step of a review to the channel, under the article's message: sent for review, changes requested, approvals, published.",
          default: true,
        },
        slackDirect: {
          type: "boolean",
          label: "Slack: direct messages",
          description:
            "Message people about their own articles: comments, suggestions, requests for changes, approvals. The Slack page tests the connection.",
          default: true,
        },
      },
      pages: [
        { path: "/queue", label: "Review queue", icon: "inbox" },
        { path: "/calendar", label: "Calendar", icon: "calendar" },
        { path: "/shared", label: "Shared with me", icon: "users" },
        { path: "/slack", label: "Slack", icon: "bell" },
      ],
      widgets: [{ id: "awaiting", size: "third", title: "Awaiting review" }],
      // Slash-menu blocks of the rich-text editor: our MDX components.
      // (Typed loosely in blocks.mjs, which astro.config.mjs also reads.)
      portableTextBlocks: portableTextBlocks as never,
      fieldWidgets: [
        {
          name: "body-format",
          label: "Body format, in the sidebar",
          fieldTypes: ["select"],
        },
        {
          name: "members-only",
          label: "Members-only switch, in the sidebar",
          fieldTypes: ["boolean"],
        },
        {
          name: "articles",
          label: "Picker of other articles, in the sidebar",
          fieldTypes: ["string"],
        },
        {
          name: "hidden",
          label: "Kept, not shown",
          fieldTypes: ["string"],
        },
      ],
      editorPanels: [
        {
          id: "review",
          title: "Review",
          route: "panel",
          collections: PANEL_COLLECTIONS,
          draft: { read: { fields: ["body", "body_rich"] } },
        },
        {
          id: "people",
          title: "Collaborators",
          route: "people",
          collections: PANEL_COLLECTIONS,
        },
      ],
      editorActions: [
        {
          id: "submit",
          label: "Submit for review",
          route: "submit",
          placement: "toolbar",
          collections: PANEL_COLLECTIONS,
        },
        {
          id: "approve",
          label: "Approve",
          route: "approve",
          placement: "toolbar",
          collections: PANEL_COLLECTIONS,
          confirm: {
            title: "Approve this article?",
            text: "You approve the text as it is now. Any edit sends it back to review.",
            confirm: "Approve",
            deny: "Cancel",
          },
        },
      ],
    },
    routes: {
      // Authors and up may comment and submit. EmDash does not let
      // contributors use editor buttons on their drafts.
      panel: { permission: "content:read_drafts", handler: panel },
      // The text editor's comments and suggestions (see admin.tsx).
      threads: { permission: "content:edit_own", handler: threads },
      // Lookups for the Slack user and channel insert forms.
      slack: { permission: "content:edit_own", handler: slackSearch },
      submit: { permission: "content:create", handler: submitAction },
      // Editors and up decide, and read the queue and calendar.
      approve: { permission: "content:publish_any", handler: approveAction },
      people: { permission: "content:read_drafts", handler: people },
      // Each page checks who is asking: "Shared with me" is for everyone.
      admin: { permission: "content:create", handler: admin },
    },
    hooks: {
      "plugin:activate": async (_event, ctx) => {
        await retireExpiry(ctx);
      },
      // A submitter's save is cut down to what a submitter may set.
      "content:beforeSave": {
        handler: async (event) => {
          if (!event.actor || event.actor.role >= ROLE.EDITOR) return;
          if (!PANEL_COLLECTIONS.includes(event.collection)) return;
          const content = event.content as Record<string, unknown>;
          return content.data && typeof content.data === "object"
            ? {
                ...content,
                data: submitterFields(content.data as Record<string, unknown>),
              }
            : submitterFields(content);
        },
      },
      "content:afterSave": {
        handler: async (event, ctx) => {
          await announceDraft(ctx, event);
          const { collections } = await rules(ctx);
          if (!collections.includes(event.collection)) return;
          const id = String(event.content.id ?? "");
          const review = (await ctx.storage.reviews.get(id)) as Review | null;
          if (!review) return;
          review.approvals ??= [];
          const hash = await fingerprint(
            fieldsOf(event.content),
            REVIEWED_FIELDS,
          );
          const wasApproved = review.state === "approved";
          const editor = event.actor?.id ?? "unknown";
          if (!noteEdit(review, editor, hash)) return;
          await ctx.storage.reviews.put(id, review);
          if (wasApproved)
            await toChannel(
              ctx,
              id,
              slackSay.voided(
                await articleOf(
                  ctx,
                  event.collection,
                  id,
                  fieldsOf(event.content).title,
                ),
                await personOf(ctx, editor),
              ),
            );
        },
      },
      "content:afterPublish": {
        handler: async (event, ctx) => {
          if (!PANEL_COLLECTIONS.includes(event.collection)) return;
          const id = String(event.content.id ?? "");
          if (!id) return;
          const text = slackSay.published(
            await articleOf(
              ctx,
              event.collection,
              id,
              fieldsOf(event.content).title,
            ),
          );
          await toChannel(ctx, id, text);
          const item = await ctx.content?.get(event.collection, id);
          const review = (await ctx.storage.reviews.get(id)) as Review | null;
          await toPeople(ctx, [item?.authorId, review?.submittedBy], "", text);
        },
      },
      "content:beforePublish": {
        handler: async (event, ctx) => {
          // Only editors put things live, approved or not.
          if (event.actor && event.actor.role < ROLE.EDITOR)
            return {
              cancel: true,
              reason: "Only editors can publish. Submit it for review.",
            };
          const { collections } = await rules(ctx);
          if (!collections.includes(event.collection)) return;
          const id = String(event.content.id ?? "");
          const review = (await ctx.storage.reviews.get(id)) as Review | null;
          const hash = await fingerprint(
            fieldsOf(event.content),
            REVIEWED_FIELDS,
          );
          const reason = publishBlock(review, hash);
          if (reason) return { cancel: true, reason };
        },
      },
      "content:beforeSchedule": {
        handler: async (event, ctx) => {
          // Only editors put things live, approved or not.
          if (event.actor && event.actor.role < ROLE.EDITOR)
            return {
              cancel: true,
              reason: "Only editors can publish. Submit it for review.",
            };
          const { collections } = await rules(ctx);
          if (!collections.includes(event.collection)) return;
          const id = String(event.content.id ?? "");
          const review = (await ctx.storage.reviews.get(id)) as Review | null;
          const hash = await fingerprint(
            fieldsOf(event.content),
            REVIEWED_FIELDS,
          );
          const reason = publishBlock(review, hash);
          if (reason) return { cancel: true, reason };
        },
      },
    },
  });
}
