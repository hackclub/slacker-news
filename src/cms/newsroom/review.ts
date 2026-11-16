/**
 * The editorial rules of the newsroom plugin, free of EmDash types so they can
 * be tested on their own. plugin.ts wires them to EmDash's hooks and routes.
 *
 * An article moves through four states:
 *
 *   draft ──submit──▶ in_review ──approve──▶ approved ──publish──▶ (live)
 *                        │  ▲                    │
 *                        ▼  └──resubmit──┐       │ edited after approval
 *                  changes_requested ────┘       ▼
 *                                              in_review
 *
 * Permissions come from EmDash's roles (see ROLE below). The plugin adds two
 * rules on top: nobody approves an article they wrote or submitted (except an
 * admin, who may be the only person around), and an approval is for one exact
 * text, so any edit sends the article back to review.
 */

/** EmDash's role levels, from @emdash-cms/auth. */
export const ROLE = {
  SUBSCRIBER: 10,
  CONTRIBUTOR: 20,
  AUTHOR: 30,
  EDITOR: 40,
  ADMIN: 50,
} as const;

export type ReviewState =
  | "draft"
  | "in_review"
  | "changes_requested"
  | "approved";

export type ReviewEvent = {
  at: string;
  by: string;
  action:
    | "submitted"
    | "approved"
    | "changes_requested"
    | "invalidated"
    | "published";
  note?: string;
};

/** What the plugin stores for one article. */
export type Review = {
  entryId: string;
  collection: string;
  state: ReviewState;
  submittedBy?: string;
  /** Fingerprint of the text the approval covers. */
  approvedHash?: string;
  approvedBy?: string;
  history: ReviewEvent[];
};

export type Actor = { id: string; role: number };

export class RuleError extends Error {}

export function newReview(entryId: string, collection: string): Review {
  return { entryId, collection, state: "draft", history: [] };
}

function record(
  review: Review,
  by: string,
  action: ReviewEvent["action"],
  note?: string,
) {
  review.history.push({
    at: new Date().toISOString(),
    by,
    action,
    ...(note ? { note } : {}),
  });
}

/**
 * Anyone who may create drafts may ask for a review of an article they can
 * edit. Reviews can be asked again after changes were requested.
 */
export function submit(review: Review, actor: Actor): Review {
  if (actor.role < ROLE.CONTRIBUTOR)
    throw new RuleError("You cannot submit articles for review.");
  if (review.state === "in_review")
    throw new RuleError("This article is already in review.");
  if (review.state === "approved")
    throw new RuleError("This article is already approved.");
  review.state = "in_review";
  review.submittedBy = actor.id;
  review.approvedHash = undefined;
  review.approvedBy = undefined;
  record(review, actor.id, "submitted");
  return review;
}

/** Only editors and admins decide, and not on their own submissions. */
function mayDecide(review: Review, actor: Actor, authorId?: string | null) {
  if (actor.role < ROLE.EDITOR)
    throw new RuleError("Only editors can decide on an article.");
  if (review.state !== "in_review")
    throw new RuleError("This article is not waiting for a decision.");
  const own = actor.id === review.submittedBy || actor.id === authorId;
  if (own && actor.role < ROLE.ADMIN)
    throw new RuleError(
      "You cannot decide on your own article. Ask another editor.",
    );
}

export function approve(
  review: Review,
  actor: Actor,
  hash: string,
  authorId?: string | null,
): Review {
  mayDecide(review, actor, authorId);
  review.state = "approved";
  review.approvedHash = hash;
  review.approvedBy = actor.id;
  record(review, actor.id, "approved");
  return review;
}

export function requestChanges(
  review: Review,
  actor: Actor,
  note: string,
  authorId?: string | null,
): Review {
  mayDecide(review, actor, authorId);
  if (!note.trim())
    throw new RuleError("Say what should change when you request changes.");
  review.state = "changes_requested";
  record(review, actor.id, "changes_requested", note.trim());
  return review;
}

/**
 * A save that changes the text of an approved article withdraws the approval.
 * Returns true when the review changed.
 */
export function noteEdit(review: Review, actor: string, hash: string): boolean {
  if (review.state !== "approved" || review.approvedHash === hash) return false;
  review.state = "in_review";
  review.approvedHash = undefined;
  review.approvedBy = undefined;
  record(review, actor, "invalidated", "Edited after approval.");
  return true;
}

/** Why an article may not be published yet, or undefined when it may. */
export function publishBlock(
  review: Review | null | undefined,
  hash: string,
): string | undefined {
  if (!review || review.state === "draft")
    return "Submit this article for review first.";
  if (review.state === "in_review") return "This article is still in review.";
  if (review.state === "changes_requested")
    return "Changes were requested. Resubmit this article for review.";
  if (review.approvedHash !== hash)
    return "The article changed after it was approved. Submit it for review again.";
  return undefined;
}

/** A short fingerprint of the parts of an article a reviewer reads. */
export async function fingerprint(
  fields: Record<string, unknown>,
  names: readonly string[],
): Promise<string> {
  const text = JSON.stringify(names.map((name) => fields[name] ?? null));
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(bytes)]
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** A comment left on a passage of an article. */
export type ReviewComment = {
  entryId: string;
  author: string;
  authorName: string;
  at: string;
  /** The passage the comment is about, copied from the article. */
  quote: string;
  body: string;
  resolved: boolean;
  resolvedBy?: string;
  /** Replies, oldest first. */
  replies: { author: string; authorName: string; at: string; body: string }[];
};

/**
 * Where a quoted passage sits in the current text, as a line number, so the
 * panel can say "line 12" for comments the text has moved away from.
 */
export function locate(
  text: string,
  quote: string,
): { line: number } | undefined {
  if (!quote) return undefined;
  const at = text.indexOf(quote);
  if (at < 0) return undefined;
  return { line: text.slice(0, at).split("\n").length };
}
