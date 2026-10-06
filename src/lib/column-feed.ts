import { getPosts, type Post } from "./content";
import {
  getMarkdownColumnArticles,
  type IndigestMessage,
  type SlackArticle,
} from "./indigest";

export type ColumnFeedItem =
  | { kind: "post"; post: Post; date: Date }
  | {
      kind: "slack";
      message: IndigestMessage;
      article: SlackArticle;
      date: Date;
      readingTime: number;
    };

function slackReadingTime(message: IndigestMessage): number {
  const wordCount = message.text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(wordCount / 200));
}

export async function getColumnFeedItems(
  columnId: string,
  authenticated: boolean,
): Promise<ColumnFeedItem[]> {
  const posts = (await getPosts())
    .filter((post) => post.category === columnId)
    .map((post) => ({ kind: "post" as const, post, date: post.date }));

  const slackItems = (await getMarkdownColumnArticles(authenticated))
    .filter(({ article }) => article.column === columnId)
    .map(({ message, article }) => ({
      kind: "slack" as const,
      message,
      article,
      date: Number.isNaN(article.date.getTime()) ? new Date(0) : article.date,
      readingTime: slackReadingTime(message),
    }));

  return [...posts, ...slackItems].sort(
    (a, b) => b.date.getTime() - a.date.getTime(),
  );
}
