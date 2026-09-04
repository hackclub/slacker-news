import type { Post } from "./content";
import type { IndigestMessage, SlackColumnConfig } from "./indigest";

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "are",
  "but",
  "not",
  "you",
  "all",
  "any",
  "can",
  "her",
  "was",
  "one",
  "our",
  "out",
  "his",
  "has",
  "had",
  "him",
  "how",
  "its",
  "who",
  "did",
  "yes",
  "she",
  "too",
  "use",
  "way",
  "why",
  "with",
  "that",
  "this",
  "from",
  "they",
  "them",
  "then",
  "than",
  "have",
  "will",
  "your",
  "what",
  "when",
  "were",
  "been",
  "into",
  "some",
  "more",
  "over",
  "such",
  "only",
  "also",
  "just",
  "like",
  "make",
  "made",
  "here",
  "very",
]);

export type TermFrequency = Record<string, number>;

export type SearchDocument = {
  url: string;
  title: string;
  excerpt: string;
  category: string;
  readingTime: number;
  text: string;
  author: string;
  titleTerms: TermFrequency;
  bodyTerms: TermFrequency;
  authorTerms: TermFrequency;
};

export type SearchIndex = {
  weights: {
    titleExact: number;
    bodyExact: number;
    authorExact: number;
    titlePrefix: number;
    bodyPrefix: number;
    authorPrefix: number;
  };
  documents: SearchDocument[];
};

function stripSlackMrkdwn(text: string): string {
  return text
    .replace(/<@[UW][A-Z0-9]+>/g, "") // user mentions
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "$1") // channel mentions with label
    .replace(/<#[A-Z0-9]+>/g, "") // channel mentions without label
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "$2") // links with label
    .replace(/<(https?:\/\/[^>]+)>/g, "$1") // plain links
    .replace(/:([a-z0-9_+-]+):/g, "") // emoji
    .replace(/\*([^*]+)\*/g, "$1") // bold
    .replace(/_([^_]+)_/g, "$1") // italic
    .replace(/~([^~]+)~/g, "$1") // strikethrough
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/```[\s\S]*?```/g, "") // code blocks
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function slackMessageToDocument(
  message: IndigestMessage,
  column: SlackColumnConfig,
): SearchDocument {
  const title =
    (typeof message.metadata === "object" && message.metadata !== null
      ? Object.values(message.metadata)[0]
      : typeof message.metadata === "string"
        ? (() => {
            try {
              const parsed = JSON.parse(message.metadata);
              return parsed && typeof parsed === "object"
                ? Object.values(parsed)[0]
                : undefined;
            } catch {
              return undefined;
            }
          })()
        : undefined) ?? column.title;

  const cleanText = stripSlackMrkdwn(message.text);
  const wordCount = cleanText.split(/\s+/).filter(Boolean).length;
  const readingTime = Math.max(1, Math.ceil(wordCount / 200));
  const url = `/slack/${encodeURIComponent(column.column)}/${encodeURIComponent(message.slackTs)}/`;

  return {
    url,
    title: String(title),
    excerpt: cleanText,
    category: column.title,
    readingTime,
    text: cleanText,
    author: "",
    titleTerms: termFrequency(String(title)),
    bodyTerms: termFrequency(cleanText),
    authorTerms: {},
  };
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (token) => token.length >= 2 && !STOPWORDS.has(token),
  );
}

function termFrequency(text: string): TermFrequency {
  const freq: TermFrequency = {};
  for (const token of tokenize(text)) {
    freq[token] = (freq[token] ?? 0) + 1;
  }
  return freq;
}

export function buildSearchIndex(
  posts: Post[],
  slackDocuments: SearchDocument[] = [],
): SearchIndex {
  const postDocuments: SearchDocument[] = posts.map((post) => ({
    url: post.url,
    title: post.title,
    excerpt: post.excerpt,
    category: post.category ?? "",
    readingTime: post.readingTime,
    text: post.paragraphs.join(" "),
    author: Array.isArray(post.author) ? post.author.join(", ") : (post.author ?? ""),
    titleTerms: termFrequency(post.title),
    bodyTerms: termFrequency(post.paragraphs.join(" ")),
    authorTerms: termFrequency(Array.isArray(post.author) ? post.author.join(" ") : (post.author ?? "")),
  }));

  return {
    weights: {
      titleExact: 10,
      bodyExact: 1,
      authorExact: 15,
      titlePrefix: 4,
      bodyPrefix: 0.4,
      authorPrefix: 8,
    },
    documents: [...postDocuments, ...slackDocuments],
  };
}

export function scoreDocument(
  doc: SearchDocument,
  queryTerms: string[],
  weights: SearchIndex["weights"],
): number {
  const tally = (freq: TermFrequency, exact: number, prefix: number) =>
    Object.entries(freq).reduce(
      (score, [indexed, count]) =>
        score +
        queryTerms.reduce(
          (sum, term) =>
            sum +
            (indexed === term
              ? count * exact
              : indexed.startsWith(term)
                ? count * prefix
                : 0),
          0,
        ),
      0,
    );

  return (
    tally(doc.titleTerms, weights.titleExact, weights.titlePrefix) +
    tally(doc.bodyTerms, weights.bodyExact, weights.bodyPrefix) +
    tally(doc.authorTerms, weights.authorExact, weights.authorPrefix)
  );
}
