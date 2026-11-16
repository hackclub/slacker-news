/**
 * Newsroom workflow for the EmDash admin: pitches from the public, review
 * requests, comments on passages, and an editor's decision that gates
 * publishing. The rules are in review.ts; this file connects them to EmDash.
 *
 * What is enforced, and where:
 *  - Who may do what is EmDash's own role check, declared per route
 *    (`permission`). The host rejects the request before this code runs.
 *  - Publishing and scheduling are blocked by the `content:beforePublish` and
 *    `content:beforeSchedule` hooks unless an editor approved the exact text.
 *    EmDash calls them for the admin, the API and the scheduler alike.
 */
import { definePlugin } from "emdash";
import { z } from "astro/zod";
import {
  approve,
  fingerprint,
  locate,
  newReview,
  noteEdit,
  publishBlock,
  requestChanges,
  ROLE,
  RuleError,
  submit,
  type Actor,
  type Review,
  type ReviewComment,
} from "./review";

/** The fields a reviewer reads; an edit to any of them voids an approval. */
const REVIEWED_FIELDS = ["title", "body", "category", "author"] as const;

/** Collections that go through review. */
const REVIEWED = ["posts"];

/** A visitor may send this many pitches per hour from one address. */
const PITCHES_PER_HOUR = 5;

const pitchInput = z.object({
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(20).max(20000),
  name: z.string().trim().min(1).max(100),
  contact: z.string().trim().min(3).max(200),
  // A real visitor leaves this empty; bots fill in every field.
  website: z.string().max(500).optional(),
});

type Pitch = {
  title: string;
  body: string;
  name: string;
  contact: string;
  at: string;
  state: "new" | "accepted" | "rejected";
  entryId?: string;
  decidedBy?: string;
};

// The context types are EmDash's; the routes only need a few members.
// eslint-disable-next-line typescript-eslint/no-explicit-any
type Ctx = any;

const who = (ctx: Ctx): Actor & { name: string } => ({
  id: ctx.user?.id ?? "unknown",
  role: ctx.user?.role ?? 0,
  name: ctx.user?.name ?? ctx.user?.email ?? "Someone",
});

async function loadReview(ctx: Ctx, entryId: string, collection: string) {
  return (
    ((await ctx.storage.reviews.get(entryId)) as Review | null) ??
    newReview(entryId, collection)
  );
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

const pretty = (state: string) => state.replace("_", " ");

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

// ---------------------------------------------------------------------------
// The review panel next to an article
// ---------------------------------------------------------------------------

async function panel(ctx: Ctx) {
  const { entry } = ctx.ui as {
    entry: { collection: string; id: string };
  };
  const actor = who(ctx);
  const input = ctx.input as {
    type: string;
    action_id?: string;
    value?: unknown;
    values?: Record<string, string>;
    draft?: { fields: Record<string, unknown> };
  };
  const text = String(input.draft?.fields?.body ?? "");

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
    } else if (input.action_id === "reply") {
      const id = String(values.comment ?? "");
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
        requestChanges(
          review,
          actor,
          String(values.note ?? ""),
          item?.authorId,
        );
        await ctx.storage.reviews.put(entry.id, review);
        say("Changes requested.");
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
  const comments = items.map((item: { id: string; data: ReviewComment }) => ({
    id: item.id,
    ...item.data,
  }));
  comments.sort((a: ReviewComment, b: ReviewComment) =>
    a.at.localeCompare(b.at),
  );
  const open = comments.filter((c: ReviewComment) => !c.resolved);

  const blocks: unknown[] = [
    {
      type: "fields",
      fields: [
        { label: "Status", value: pretty(review.state) },
        { label: "Open comments", value: String(open.length) },
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

  for (const comment of comments) {
    const place = comment.quote ? locate(text, comment.quote) : undefined;
    const where = comment.quote
      ? `“${comment.quote.slice(0, 160)}”${
          text ? (place ? ` (line ${place.line})` : " (text has changed)") : ""
        }`
      : "";
    const replies = comment.replies
      .map(
        (r: ReviewComment["replies"][number]) =>
          `\n> **${r.authorName}:** ${r.body}`,
      )
      .join("");
    blocks.push(
      { type: "divider" },
      {
        type: "section",
        text: `${comment.resolved ? "~~" : ""}**${comment.authorName}**${
          where ? `\n${where}` : ""
        }\n${comment.body}${comment.resolved ? "~~" : ""}${replies}`,
        accessory: {
          type: "button",
          action_id: "resolve",
          label: comment.resolved ? "Reopen" : "Resolve",
          value: comment.id,
        },
      },
    );
    if (!comment.resolved)
      blocks.push({
        type: "form",
        fields: [
          {
            type: "text_input",
            action_id: "body",
            label: "Reply",
          },
          {
            type: "text_input",
            action_id: "comment",
            label: "comment",
            initial_value: comment.id,
          },
        ],
        submit: { label: "Reply", action_id: "reply" },
      });
  }

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

  if (review.history.length)
    blocks.push(
      { type: "divider" },
      {
        type: "context",
        text: review.history
          .map(
            (event) =>
              `${event.at.slice(0, 16).replace("T", " ")} · ${pretty(event.action)}`,
          )
          .join("\n"),
      },
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
    const { entry } = await snapshot(ctx);
    const review = await loadReview(ctx, entry.id, entry.collection);
    submit(review, who(ctx));
    await ctx.storage.reviews.put(entry.id, review);
    return toast("Sent for review.");
  });
}

async function approveAction(ctx: Ctx) {
  return guarded(async () => {
    const { entry, item, hash } = await snapshot(ctx);
    const review = await loadReview(ctx, entry.id, entry.collection);
    approve(review, who(ctx), hash, item.authorId);
    await ctx.storage.reviews.put(entry.id, review);
    return toast("Approved. The article can be published.");
  });
}

// ---------------------------------------------------------------------------
// Pitches from the public, and the queue editors work through
// ---------------------------------------------------------------------------

async function sendPitch(ctx: Ctx) {
  const parsed = pitchInput.safeParse(ctx.input);
  if (!parsed.success)
    return { ok: false, error: "Check the form and try again." };
  // A filled-in trap field means a bot. Pretend it worked.
  if (parsed.data.website) return { ok: true };

  const ip = ctx.requestMeta?.ip ?? "unknown";
  const key = `rate:${ip}:${new Date().toISOString().slice(0, 13)}`;
  const used = ((await ctx.kv.get(key)) as number | null) ?? 0;
  if (used >= PITCHES_PER_HOUR)
    return { ok: false, error: "Too many pitches. Try again later." };
  await ctx.kv.set(key, used + 1);

  const { website: _trap, ...fields } = parsed.data;
  await ctx.storage.pitches.put(crypto.randomUUID(), {
    ...fields,
    at: new Date().toISOString(),
    state: "new",
  } satisfies Pitch);
  return { ok: true };
}

async function queue(ctx: Ctx) {
  const actor = who(ctx);
  const input = ctx.input as {
    type: string;
    action_id?: string;
    value?: unknown;
  };
  let notice: { message: string; type: "success" | "error" } | undefined;

  if (input.type === "block_action" && input.value) {
    const id = String(input.value);
    const pitch = (await ctx.storage.pitches.get(id)) as Pitch | null;
    if (pitch && pitch.state === "new") {
      if (input.action_id === "accept") {
        // The pitch becomes an ordinary draft, owned by whoever accepted it,
        // with the sender credited in the byline field.
        const item = await ctx.content.create("posts", {
          title: pitch.title,
          body: pitch.body,
          category: "news",
          author: pitch.name,
          date: new Date().toISOString(),
          body_format: "mdx",
        });
        await ctx.storage.pitches.put(id, {
          ...pitch,
          state: "accepted",
          entryId: item.id,
          decidedBy: actor.id,
        });
        return {
          blocks: [],
          toast: { message: "Draft created.", type: "success" },
          navigate: { kind: "content", collection: "posts", id: item.id },
        };
      }
      if (input.action_id === "reject") {
        await ctx.storage.pitches.put(id, {
          ...pitch,
          state: "rejected",
          decidedBy: actor.id,
        });
        notice = { message: "Rejected.", type: "success" };
      }
    }
  }

  const { items } = await ctx.storage.pitches.query({
    where: { state: "new" },
    limit: 100,
  });
  const reply = (blocks: unknown[]) =>
    notice ? { blocks, toast: notice } : { blocks };
  if (!items.length)
    return reply([
      { type: "header", text: "Pitches" },
      { type: "context", text: "No new pitches." },
    ]);
  const blocks: unknown[] = [{ type: "header", text: "Pitches" }];
  for (const { id, data } of items as { id: string; data: Pitch }[])
    blocks.push(
      { type: "divider" },
      {
        type: "section",
        text: `**${data.title}**\nfrom ${data.name} (${data.contact}), ${data.at.slice(0, 10)}\n\n${data.body.slice(0, 600)}${data.body.length > 600 ? "…" : ""}`,
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: "accept",
            label: "Make a draft",
            style: "primary",
            value: id,
          },
          {
            type: "button",
            action_id: "reject",
            label: "Reject",
            style: "danger",
            value: id,
            confirm: {
              title: "Reject this pitch?",
              text: "The sender is not told.",
              confirm: "Reject",
              deny: "Cancel",
            },
          },
        ],
      },
    );
  return reply(blocks);
}

// ---------------------------------------------------------------------------

export function createPlugin() {
  return definePlugin({
    id: "newsroom",
    version: "0.1.0",
    capabilities: [
      "content:read",
      "content:write",
      "hooks.content-policy:register",
    ],
    storage: {
      reviews: { indexes: ["state", "collection"] },
      comments: { indexes: ["entryId", "resolved"] },
      pitches: { indexes: ["state"] },
    },
    admin: {
      pages: [{ path: "/pitches", label: "Pitches", icon: "inbox" }],
      editorPanels: [
        {
          id: "review",
          title: "Review",
          route: "panel",
          collections: REVIEWED,
          draft: { read: { fields: ["body"] } },
        },
      ],
      editorActions: [
        {
          id: "submit",
          label: "Submit for review",
          route: "submit",
          placement: "toolbar",
          collections: REVIEWED,
        },
        {
          id: "approve",
          label: "Approve",
          route: "approve",
          placement: "toolbar",
          collections: REVIEWED,
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
      // Contributors and up may comment and submit.
      panel: { permission: "content:read_drafts", handler: panel },
      submit: { permission: "content:create", handler: submitAction },
      // Editors and up decide, and read the pitch queue.
      approve: { permission: "content:publish_any", handler: approveAction },
      admin: { permission: "content:edit_any", handler: queue },
      // Anyone may pitch. Nothing is written to the site's content.
      pitch: {
        public: true,
        input: pitchInput,
        handler: sendPitch,
      },
    },
    hooks: {
      "content:afterSave": {
        handler: async (event, ctx) => {
          if (!REVIEWED.includes(event.collection)) return;
          const id = String(event.content.id ?? "");
          const review = (await ctx.storage.reviews.get(id)) as Review | null;
          if (!review || review.state !== "approved") return;
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
          if (!REVIEWED.includes(event.collection)) return;
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
          if (!REVIEWED.includes(event.collection)) return;
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
