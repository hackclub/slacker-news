import {
  firstMetadataValue,
  getIndigestMessages,
  type SlackColumnConfig,
} from "./indigest";

export type TickerHeadline = { title: string; href: string; date: number };

// Each source gets at most this many headlines, so a high-volume column
// (e.g. YSWS) can't crowd out every other article type in the ticker.
export const MAX_HEADLINES_PER_SOURCE = 4;

function timestampToNumber(timestamp: string): number {
  const parsed = new Date(timestamp).getTime();
  if (!Number.isNaN(parsed)) return parsed;

  const slackTimestamp = Number(timestamp);
  return Number.isFinite(slackTimestamp) ? slackTimestamp * 1000 : 0;
}

export async function getSlackColumnHeadlines(
  column: SlackColumnConfig,
): Promise<TickerHeadline[]> {
  const messages = await getIndigestMessages(
    column.channelId ?? column.column,
    20,
  );

  return messages
    .map((message) => ({
      title: `${column.noun ?? column.title}: ${firstMetadataValue(message.metadata) ?? column.title}`,
      href: `/slack/${encodeURIComponent(column.column)}/${encodeURIComponent(message.slackTs)}/`,
      date: timestampToNumber(message.timestamp || message.slackTs),
    }))
    .sort((a, b) => b.date - a.date)
    .slice(0, MAX_HEADLINES_PER_SOURCE);
}
