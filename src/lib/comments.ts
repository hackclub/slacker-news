import { INDIGEST_TIMEOUT_MS } from "./indigest";

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

export type Comment = {
  slackTs: string;
  userId: string;
  userName: string;
  text: string;
  formattedText: string | null;
  timestamp: string;
  // Set when the comment was edited in Slack after it was posted.
  editedAt?: string;
};

export type CommentUsage = {
  used: number;
  total: number;
  usedToday: number;
  perDay: number;
};

// "off" and "unavailable" are not the same as an article with no comments yet:
// the reader is told when comments could not be loaded, rather than shown an
// empty list.
export type CommentsResult =
  | { status: "off" }
  | { status: "unavailable" }
  | {
      status: "ok";
      // Where replies are made. Null when the article was never posted there.
      card: { slackTs: string; channelId: string } | null;
      comments: Comment[];
      viewer?: CommentUsage;
    };

// Comments are read fresh on every request. Unlike the Slack columns they are
// not cached, because a cached list could keep showing a comment that has
// since been deleted.
export async function getComments(
  articleKey: string,
  viewerSlackId?: string | null,
): Promise<CommentsResult> {
  const channel = getCommentsChannelId();
  if (!channel) return { status: "off" };

  const apiKey = import.meta.env.INDIGEST_API_KEY;
  if (!apiKey) return { status: "unavailable" };

  const url = new URL(
    "/api/threads",
    import.meta.env.INDIGEST_API_URL ?? "https://indigest.matmanna.dev",
  );
  url.searchParams.set("channel", channel);
  url.searchParams.set("key", articleKey);
  url.searchParams.set("perDay", String(COMMENT_LIMITS.perDay));
  url.searchParams.set("total", String(COMMENT_LIMITS.total));
  url.searchParams.set("timeZone", COMMENT_LIMITS.timeZone);
  if (viewerSlackId) url.searchParams.set("viewer", viewerSlackId);

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(INDIGEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(
        `Indigest returned ${response.status} for comments on ${articleKey}`,
      );
      return { status: "unavailable" };
    }

    const { data } = (await response.json()) as {
      data?: {
        card: { slackTs: string; channelId: string } | null;
        replies: Comment[];
        viewer?: CommentUsage;
      };
    };
    if (!data || !Array.isArray(data.replies)) return { status: "unavailable" };
    return {
      status: "ok",
      card: data.card,
      comments: data.replies,
      viewer: data.viewer,
    };
  } catch (error) {
    console.error(`Unable to load comments on ${articleKey}`, error);
    return { status: "unavailable" };
  }
}
