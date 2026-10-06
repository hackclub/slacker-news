import {
  getIndigestMessages,
  getSlackArticle,
  type SlackColumnConfig,
} from "./indigest";

export type TickerHeadline = { title: string; href: string; date: number };

// Each source gets at most this many headlines, so a high-volume column
// (e.g. YSWS) can't crowd out every other article type in the ticker.
export const MAX_HEADLINES_PER_SOURCE = 4;

export async function getSlackColumnHeadlines(
  column: SlackColumnConfig,
): Promise<TickerHeadline[]> {
  const messages = await getIndigestMessages(
    column.channelId ?? column.column,
    20,
  );

  return messages
    .flatMap((message) => {
      const article = getSlackArticle(message, column);
      if (!article) return [];
      // Articles in markdown columns read like any other article headline.
      const prefix = column.markdownColumns
        ? ""
        : `${column.noun ?? column.title}: `;
      return [
        {
          title: `${prefix}${article.title}`,
          href: article.url,
          date: article.date.getTime() || 0,
        },
      ];
    })
    .sort((a, b) => b.date - a.date)
    .slice(0, MAX_HEADLINES_PER_SOURCE);
}
