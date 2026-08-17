import { getPosts, type Post } from "./content";
import {
  getIndigestMessages,
  getSlackColumns,
  type IndigestMessage,
  type SlackColumnConfig,
} from "./indigest";

export type ColumnFeedItem =
  | { kind: "post"; post: Post; date: Date }
  | { kind: "slack"; column: SlackColumnConfig; message: IndigestMessage; date: Date; readingTime: number };

function slackDate(message: IndigestMessage): Date {
  const parsed = new Date(message.timestamp);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const timestamp = Number(message.slackTs);
  return Number.isFinite(timestamp) ? new Date(timestamp * 1000) : new Date(0);
}

function slackReadingTime(message: IndigestMessage): number {
  const wordCount = message.text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(wordCount / 200));
}

export function firstMetadataValue(metadata: IndigestMessage["metadata"]): string | undefined {
  let parsed: Record<string, unknown> | undefined;

  if (typeof metadata === "string") {
    try {
      const value = JSON.parse(metadata);
      if (value && typeof value === "object" && !Array.isArray(value)) parsed = value;
    } catch {
      return undefined;
    }
  } else if (metadata && typeof metadata === "object") {
    parsed = metadata;
  }

  const value = parsed ? Object.values(parsed)[0] : undefined;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value !== undefined && value !== null) return String(value);
  return undefined;
}

export async function getColumnFeedItems(
  columnId: string,
  authenticated: boolean,
): Promise<ColumnFeedItem[]> {
  const posts = (await getPosts())
    .filter((post) => post.category === columnId)
    .map((post) => ({ kind: "post" as const, post, date: post.date }));

  const slackColumns = getSlackColumns().filter(
    (column) => column.column === columnId && (!column.authRequired || authenticated),
  );
  const slackMessages = await Promise.all(
    slackColumns.map(async (column) => ({
      column,
      messages: await getIndigestMessages(column.channelId ?? column.column, column.limit),
    })),
  );

  const slackItems = slackMessages.flatMap(({ column, messages }) =>
    messages.map((message) => ({
      kind: "slack" as const,
      column,
      message,
      date: slackDate(message),
      readingTime: slackReadingTime(message),
    })),
  );

  return [...posts, ...slackItems].sort((a, b) => b.date.getTime() - a.date.getTime());
}
