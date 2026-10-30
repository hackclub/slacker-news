// Comments are replies in a Slack thread under an article's card in the
// comments channel (#news in production). Indigest ingests them and enforces
// the limits; the site only reads. See docs/comments-plan.md.

export const COMMENT_LIMITS = {
  perDay: 2,
  total: 3,
  // A "day" ends at midnight Eastern.
  timeZone: "America/New_York",
} as const;

// The channel whose threads hold comments. Unset turns the feature off, so a
// deployment without it behaves exactly as before.
export function getCommentsChannelId(): string | undefined {
  const id = import.meta.env.COMMENTS_CHANNEL_ID?.trim();
  return id && /^[CG][A-Z0-9]+$/.test(id) ? id : undefined;
}
