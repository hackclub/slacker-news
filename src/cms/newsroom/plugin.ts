/**
 * Newsroom workflow for the EmDash admin: review requests, comments on
 * passages, approvals by named editors, and a gate that keeps an article from
 * going live until the exact text was approved. It also gives editors a review
 * queue, a dashboard card, an editorial calendar and article expiry.
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
import {
  approve,
  dayOf,
  expired,
  fingerprint,
  locate,
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

/** The fields a reviewer reads; an edit to any of them voids an approval. */
const REVIEWED_FIELDS = ["title", "body", "category", "author"] as const;

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

async function titleOf(ctx: Ctx, collection: string, id: string) {
  const item = await ctx.content.get(collection, id);
  return String(item?.data?.title ?? item?.slug ?? id);
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
  const text = String(input.draft?.fields?.body ?? "");

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

  if (input.type === "form_submit" && input.values) {
    const values = input.values;
    if (input.action_id === "comment") {
      const body = String(values.body ?? "").trim();
      const quote = String(values.quote ?? "").trim();
      if (!body) say("Write a comment first.", "error");
      else if (quote && text && !locate(text, quote))
        say("That passage is not in the article.", "error");
      else {
        const comment: ReviewComment = {
          entryId: entry.id,
          author: actor.id,
          authorName: actor.name,
          at: new Date().toISOString(),
          quote,
          body,
          resolved: false,
          replies: [],
        };
        await ctx.storage.comments.put(crypto.randomUUID(), comment);
        say("Comment added.");
      }
    } else if (input.action_id?.startsWith("reply:")) {
      const id = input.action_id.slice("reply:".length);
      const comment = (await ctx.storage.comments.get(id)) as ReviewComment;
      const body = String(values.body ?? "").trim();
      if (!comment || comment.entryId !== entry.id || !body)
        say("Nothing to reply to.", "error");
      else {
        comment.replies.push({
          author: actor.id,
          authorName: actor.name,
          at: new Date().toISOString(),
          body,
        });
        await ctx.storage.comments.put(id, comment);
        say("Reply added.");
      }
    } else if (input.action_id === "request-changes") {
      try {
        const review = await loadReview(ctx, entry.id, entry.collection);
        const item = await ctx.content.get(entry.collection, entry.id);
        const note = String(values.note ?? "");
        requestChanges(review, actor, note, item?.authorId);
        await ctx.storage.reviews.put(entry.id, review);
        say("Changes requested.");
        if (notify)
          await mail(
            ctx,
            review.submitterEmail,
            `Changes requested: ${await titleOf(ctx, entry.collection, entry.id)}`,
            `${actor.name} asked for changes:\n\n${note.trim()}\n\n${adminLink(ctx, entry.collection, entry.id)}`,
          );
      } catch (error) {
        if (!(error instanceof RuleError)) throw error;
        say(error.message, "error");
      }
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
    const place = comment.quote ? locate(text, comment.quote) : undefined;
    const when = new Date(comment.at).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    const lines: unknown[] = [
      {
        type: "context",
        text: `${comment.authorName} · ${when}${place ? ` · line ${place.line}` : ""}`,
      },
    ];
    if (comment.quote)
      lines.push({
        type: "context",
        text: `“${comment.quote.slice(0, 160)}”${
          text && !place ? " (text has changed)" : ""
        }`,
      });
    lines.push({ type: "section", text: comment.body });
    for (const reply of comment.replies)
      lines.push({
        type: "section",
        text: `${reply.authorName}: ${reply.body}`,
      });
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
    if (!comment.resolved)
      lines.push({
        type: "form",
        fields: [{ type: "text_input", action_id: "body", label: "Reply" }],
        submit: { label: "Reply", action_id: `reply:${comment.id}` },
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

  blocks.push(
    { type: "divider" },
    {
      type: "form",
      fields: [
        {
          type: "text_input",
          action_id: "quote",
          label: "Passage (paste from the article)",
          multiline: true,
        },
        {
          type: "text_input",
          action_id: "body",
          label: "Comment",
          multiline: true,
        },
      ],
      submit: { label: "Comment", action_id: "comment" },
    },
  );

  if (actor.role >= ROLE.EDITOR && review.state === "in_review")
    blocks.push({
      type: "form",
      fields: [
        {
          type: "text_input",
          action_id: "note",
          label: "What should change?",
          multiline: true,
        },
      ],
      submit: { label: "Request changes", action_id: "request-changes" },
    });

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
    hash: await fingerprint(item.data, REVIEWED_FIELDS),
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
    if (review.state === "approved") {
      if (notify)
        await mail(
          ctx,
          review.submitterEmail,
          `Approved: ${String(item.data.title ?? entry.id)}`,
          `It can now be published.\n\n${adminLink(ctx, entry.collection, entry.id)}`,
        );
      return toast("Approved. The article can be published.");
    }
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
          text: `**${name}**\n${pretty(data.state)} · ${data.approvals.length} of ${policy.required} approvals${mine ? " · you approved" : ""}`,
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
      const expires = item.data.expires_at;
      if (item.status === "published" && typeof expires === "string")
        rows.push({
          at: expires,
          what: expired(expires) ? "Expired" : "Expires",
          title,
        });
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
          text: "Nothing is scheduled to go live or expire.",
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

async function admin(ctx: Ctx) {
  await ensureCron(ctx);
  const { page } = ctx.input as { page?: string };
  if (page === "widget:awaiting") return widget(ctx);
  if (page === "/calendar") return calendar(ctx);
  return queue(ctx);
}

// ---------------------------------------------------------------------------
// Expiry: an article with an "Expires" date comes down when it passes
// ---------------------------------------------------------------------------

async function ensureCron(ctx: Ctx) {
  try {
    const tasks = await ctx.cron.list();
    if (!tasks.some((task: { name: string }) => task.name === "expire"))
      await ctx.cron.schedule("expire", { schedule: "0 * * * *" });
  } catch (error) {
    ctx.log.warn("Could not schedule expiry", { error: String(error) });
  }
}

async function expireArticles(ctx: Ctx) {
  const { collections } = await rules(ctx);
  for (const collection of collections) {
    const { items } = await ctx.content.list(collection, {
      limit: 200,
      orderBy: { updatedAt: "desc" },
    });
    for (const item of items as {
      id: string;
      status: string;
      data: Record<string, unknown>;
    }[]) {
      if (item.status !== "published" || !expired(item.data.expires_at))
        continue;
      const versioned = await ctx.content.getVersioned(collection, item.id);
      if (!versioned) continue;
      await ctx.content.unpublish(collection, item.id, {
        _rev: versioned._rev,
      });
      ctx.log.info("Unpublished an expired article", {
        collection,
        id: item.id,
      });
    }
  }
}

// ---------------------------------------------------------------------------

export function createPlugin() {
  return definePlugin({
    id: "newsroom",
    version: "0.2.0",
    capabilities: [
      "content:read",
      "content:write",
      "content:publish",
      "email:send",
      "hooks.content-policy:register",
      // The review panel reads the unsaved text, to find quoted passages.
      "admin.editor-draft:read",
    ],
    storage: {
      reviews: { indexes: ["state", "collection"] },
      comments: { indexes: ["entryId", "resolved"] },
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
      },
      pages: [
        { path: "/queue", label: "Review queue", icon: "inbox" },
        { path: "/calendar", label: "Calendar", icon: "calendar" },
      ],
      widgets: [{ id: "awaiting", size: "third", title: "Awaiting review" }],
      editorPanels: [
        {
          id: "review",
          title: "Review",
          route: "panel",
          collections: PANEL_COLLECTIONS,
          draft: { read: { fields: ["body"] } },
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
      submit: { permission: "content:create", handler: submitAction },
      // Editors and up decide, and read the queue and calendar.
      approve: { permission: "content:publish_any", handler: approveAction },
      admin: { permission: "content:edit_any", handler: admin },
    },
    hooks: {
      "plugin:activate": async (_event, ctx) => {
        await ensureCron(ctx);
      },
      cron: async (event, ctx) => {
        if (event.name === "expire") await expireArticles(ctx);
      },
      "content:afterSave": {
        handler: async (event, ctx) => {
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
          if (noteEdit(review, event.actor?.id ?? "unknown", hash))
            await ctx.storage.reviews.put(id, review);
        },
      },
      "content:beforePublish": {
        handler: async (event, ctx) => {
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
