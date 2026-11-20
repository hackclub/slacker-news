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

// Limits are off unless COMMENT_LIMITS_ENABLED is 1 or true. Without them every
// reply in a card's thread shows, and nothing is said about allowances.
export function commentLimitsEnabled(): boolean {
  const value = import.meta.env.COMMENT_LIMITS_ENABLED?.trim().toLowerCase();
  return value === "1" || value === "true";
}

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
  // Indigest holds back replies over the limits only when it is given them.
  if (commentLimitsEnabled()) {
    url.searchParams.set("perDay", String(COMMENT_LIMITS.perDay));
    url.searchParams.set("total", String(COMMENT_LIMITS.total));
    url.searchParams.set("timeZone", COMMENT_LIMITS.timeZone);
    if (viewerSlackId) url.searchParams.set("viewer", viewerSlackId);
  }

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

// A link that opens a reply in its thread in Slack, where it can be answered.
export function slackReplyLink(
  channelId: string,
  slackTs: string,
  threadTs: string,
): string {
  const link = new URL(
    `https://hackclub.slack.com/archives/${channelId}/p${slackTs.replace(".", "")}`,
  );
  link.searchParams.set("thread_ts", threadTs);
  link.searchParams.set("cid", channelId);
  return link.toString();
}

// The id a comment's element carries, which the page links to.
export function commentAnchor(slackTs: string): string {
  return `comment-${slackTs.replace(".", "-")}`;
}

// A time of day as well as a date, since comments are made close together.
export function formatCommentTime(timestamp: string): string {
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: COMMENT_LIMITS.timeZone,
    timeZoneName: "short",
  });
}

// Marks that a reader is logged in, so the page can show a skeleton for the
// comments while they load. The session itself stays in an HttpOnly cookie;
// this one says nothing a reader's own browser did not already know.
export const LOGGED_IN_COOKIE = "sn_in";

// --- Replies to replies ---
//
// A Slack thread is flat: every reply belongs to the card. People answer a
// particular reply by pasting a link to it, and that link is all there is to
// go on, so a comment that links to an earlier comment in the same thread is
// shown nested under it.

const PERMALINK =
  /https?:\/\/[^\s<>|]*\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})/g;

/** The Slack timestamps of the messages in the comments channel a comment links to. */
export function linkedTimestamps(
  comment: Comment,
  channelId: string,
): string[] {
  const found: string[] = [];
  for (const text of [comment.formattedText, comment.text]) {
    for (const match of text?.matchAll(PERMALINK) ?? []) {
      if (match[1] === channelId) found.push(`${match[2]}.${match[3]}`);
    }
  }
  return [...new Set(found)];
}

export type CommentNode = {
  comment: Comment;
  depth: number;
  // The comment this one answers, when nested.
  parent?: CommentNode;
  replies: CommentNode[];
};

// Replies nest this many levels; deeper ones sit beside the last level, so a
// long exchange does not squeeze into a sliver.
export const MAX_COMMENT_DEPTH = 3;

/**
 * Arranges comments, oldest first, into threads. A comment goes under the first
 * earlier comment it links to. A link to the card, to a comment that is not
 * shown (deleted, over a limit), to itself, or to a later comment is ignored.
 */
export function nestComments(
  comments: Comment[],
  channelId: string,
): CommentNode[] {
  const sorted = [...comments].sort(
    (a, b) => Number(a.slackTs) - Number(b.slackTs),
  );
  const nodes = new Map<string, CommentNode>();
  const roots: CommentNode[] = [];

  for (const comment of sorted) {
    const node: CommentNode = { comment, depth: 0, replies: [] };
    const target = linkedTimestamps(comment, channelId)
      .map((ts) => nodes.get(ts))
      .find((candidate): candidate is CommentNode => Boolean(candidate));

    if (target) {
      let parent = target;
      while (parent.depth >= MAX_COMMENT_DEPTH - 1 && parent.parent)
        parent = parent.parent;
      node.parent = target;
      node.depth = Math.min(target.depth + 1, MAX_COMMENT_DEPTH - 1);
      parent.replies.push(node);
    } else {
      roots.push(node);
    }
    nodes.set(comment.slackTs, node);
  }
  return roots;
}

/**
 * A comment's text without the link that nested it. Once the comment sits
 * under the one it answers, and says so, a pasted link to it is only noise: a
 * bare link goes, and a labelled one keeps its label.
 */
export function withoutReplyLink(
  text: string,
  parentTs: string,
  channelId: string,
): string {
  const points = (url: string) => {
    const match = /\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})/.exec(url);
    return match?.[1] === channelId && `${match[2]}.${match[3]}` === parentTs;
  };
  return text
    .replace(/<(https?:\/\/[^|>\s]+)\|([^>]*)>/g, (whole, url, label) =>
      points(url) ? label : whole,
    )
    .replace(/<(https?:\/\/[^|>\s]+)>/g, (whole, url) =>
      points(url) ? "" : whole,
    )
    .replace(/(?<![<|])https?:\/\/[^\s<>|]+/g, (whole) =>
      points(whole) ? "" : whole,
    )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
