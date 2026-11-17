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
 * Permissions come from EmDash's roles (see ROLE below). The plugin adds
 * rules on top: nobody approves an article they wrote or submitted (except an
 * admin, who may be the only person around); an approval is for one exact
 * text, so any edit sends the article back to review; an article may need
 * several approvals from different people; and a site may name who the
 * approvers are.
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
    | "approval_recorded"
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
  /** Where to send word of the decision. */
  submitterEmail?: string;
  /** Approvals given to the current text, one per person. */
  approvals: { by: string; at: string; hash: string }[];
  /** Fingerprint of the text the approval covers. */
  approvedHash?: string;
  approvedBy?: string;
  history: ReviewEvent[];
};

export type Actor = { id: string; role: number; email?: string };

/** What a site asks of an approval. */
export type Policy = {
  /** How many different people must approve. */
  required: number;
  /** Ids or emails of the people who may approve. Empty means any editor. */
  approvers: string[];
};

export const DEFAULT_POLICY: Policy = { required: 1, approvers: [] };

export class RuleError extends Error {}

export function newReview(entryId: string, collection: string): Review {
  return { entryId, collection, state: "draft", approvals: [], history: [] };
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
  review.submitterEmail = actor.email;
  review.approvals = [];
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
  policy: Policy = DEFAULT_POLICY,
): Review {
  mayDecide(review, actor, authorId);
  const named = policy.approvers.map((entry) => entry.toLowerCase());
  const listed =
    named.includes(actor.id.toLowerCase()) ||
    (actor.email !== undefined && named.includes(actor.email.toLowerCase()));
  if (named.length > 0 && !listed && actor.role < ROLE.ADMIN)
    throw new RuleError("You are not one of the approvers.");

  // Approvals of an older text no longer count.
  review.approvals = (review.approvals ?? []).filter(
    (entry) => entry.hash === hash,
  );
  if (review.approvals.some((entry) => entry.by === actor.id))
    throw new RuleError("You already approved this article.");
  review.approvals.push({ by: actor.id, at: new Date().toISOString(), hash });

  if (review.approvals.length < policy.required) {
    record(
      review,
      actor.id,
      "approval_recorded",
      `${review.approvals.length} of ${policy.required}`,
    );
    return review;
  }
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
  review.approvals = [];
  record(review, actor.id, "changes_requested", note.trim());
  return review;
}

/**
 * A save that changes the text of an approved article withdraws the approval.
 * Returns true when the review changed.
 */
export function noteEdit(review: Review, actor: string, hash: string): boolean {
  if (review.state === "in_review") {
    // Approvals given so far were for other text.
    const before = (review.approvals ?? []).length;
    review.approvals = (review.approvals ?? []).filter(
      (entry) => entry.hash === hash,
    );
    if (review.approvals.length === before) return false;
    record(review, actor, "invalidated", "Edited after approvals were given.");
    return true;
  }
  if (review.state !== "approved" || review.approvedHash === hash) return false;
  review.state = "in_review";
  review.approvals = [];
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
  /** A comment is a note; a suggestion proposes new text for the passage. */
  kind?: "comment" | "suggestion";
  /** For a suggestion: the text that should replace the quote. May be empty. */
  replacement?: string;
  /** True for a suggestion made by typing in suggesting mode. The editor keeps these in step with the writer's changes. */
  auto?: boolean;
  /** For a suggestion: where it stands. Comments have no status. */
  status?: "open" | "accepted" | "rejected";
  /** Text around the quote and where it began, to find it again. */
  prefix?: string;
  suffix?: string;
  start?: number;
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

/** Reads the comma-separated list of approvers from a setting. */
export function parseApprovers(value: unknown): string[] {
  return String(value ?? "")
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** The policy a site's settings describe, with limits applied. */
export function policyFrom(settings: {
  requiredApprovals?: unknown;
  approvers?: unknown;
}): Policy {
  const required = Math.round(Number(settings.requiredApprovals));
  return {
    required: Number.isFinite(required)
      ? Math.min(5, Math.max(1, required))
      : 1,
    approvers: parseApprovers(settings.approvers),
  };
}

/** The collections whose articles go through review. */
export function reviewedCollections(value: unknown): string[] {
  const names = String(value ?? "posts")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return names.length ? names : ["posts"];
}

/** A day heading such as "2026-11-20" for the calendar. */
export function dayOf(iso: string): string {
  return iso.slice(0, 10);
}
