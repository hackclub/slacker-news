// Decides which items /feed.xml carries. Kept free of Astro and network code
// so the retroactive-feed check (scripts/feed-guids.ts) can run it against
// both sides of a pull request.
import {
  firstMetadataValue,
  type IndigestMessage,
  type SlackColumnConfig,
} from "./indigest";

export type FeedPost = {
  slug: string;
  url: string;
  title: string;
  excerpt: string;
  date: Date;
  category?: string;
  paragraphs: string[];
  leadingImage?: { src: string; alt?: string };
};

export type FeedChangelog = {
  url: string;
  title: string;
  excerpt: string;
  // YYYY-MM-DD
  date: string;
  paragraphs: string[];
};

export type FeedSlackColumn = {
  column: SlackColumnConfig;
  messages: IndigestMessage[];
};

export type FeedItem = {
  title: string;
  description?: string;
  pubDate: Date;
  // Doubles as the item's GUID in readers.
  link: string;
  content: string;
  customData?: string;
};

// Whether a feed id (an article category or slack-<column>) belongs in the
// feed, given whether it is on by default.
export type FeedSelection = (id: string, isDefault: boolean) => boolean;

const DEFAULT_IMAGE =
  "https://cdn.hackclub.com/019dbae9-5242-745b-acd2-3476ab3c52a3/og-default.png";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function listParam(params: URLSearchParams, name: string): Set<string> {
  return new Set(
    (params.get(name) ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

// A bare ?name counts as set; only an explicit 0 or false turns it off.
function isFlagSet(params: URLSearchParams, name: string): boolean {
  const value = params.get(name);
  return value !== null && value !== "0" && value.toLowerCase() !== "false";
}

// The feed carries its defaults (every article category plus the Slack
// columns marked rss), adjusted by ?exclude= and ?include=, as built on /rss/.
// Ids are article categories (news, opinion, essays, changelogs) and
// slack-<column>. Links only name departures from the defaults, so changing
// a default later reaches existing subscribers. ?includeOnly opts out of
// that: the feed is exactly ?include=, and defaults and ?exclude= are ignored.
export function getFeedSelection(params: URLSearchParams): FeedSelection {
  const include = listParam(params, "include");
  if (isFlagSet(params, "includeOnly")) return (id) => include.has(id);
  const exclude = listParam(params, "exclude");
  return (id, isDefault) => (isDefault || include.has(id)) && !exclude.has(id);
}

export function getFeedSlackColumns(
  columns: SlackColumnConfig[],
  wants: FeedSelection,
  canRead: (column: SlackColumnConfig) => boolean,
): SlackColumnConfig[] {
  return columns.filter(
    (column) =>
      wants(`slack-${column.column}`, Boolean(column.rss)) &&
      (!column.authRequired || canRead(column)),
  );
}

function paragraphsHtml(paragraphs: string[], fallback: string): string {
  return paragraphs.length
    ? paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")
    : `<p>${escapeHtml(fallback)}</p>`;
}

export function buildFeedItems({
  posts,
  changelogs,
  slack,
  wants,
  legacyPaths,
}: {
  posts: FeedPost[];
  changelogs: FeedChangelog[];
  slack: FeedSlackColumn[];
  wants: FeedSelection;
  // Old top-level post paths, without trailing slashes; posts that had one
  // keep it as their link so readers don't see them as new items.
  legacyPaths: Set<string>;
}): FeedItem[] {
  const postItems = posts
    .filter((post) => wants(post.category ?? "", true))
    .map((post): FeedItem => {
      const baseSlug = post.slug.split("/").pop();
      const legacyKey = baseSlug ? `/${baseSlug}` : null;
      const link =
        legacyKey && legacyPaths.has(legacyKey) ? `${legacyKey}/` : post.url;
      const imageSrc = post.leadingImage?.src ?? DEFAULT_IMAGE;
      const imageAlt = post.leadingImage?.alt ?? "Slacker News social preview";

      return {
        title: post.title,
        description: post.excerpt,
        pubDate: post.date,
        link,
        content: paragraphsHtml(post.paragraphs, post.excerpt),
        // @astrojs/rss doesn't support Media RSS
        customData: `
                <media:content url="${imageSrc}" medium="image" />
                <media:thumbnail url="${imageSrc}" />
                <media:title type="plain">${imageAlt}</media:title>
            `,
      };
    });

  const changelogItems = wants("changelogs", true)
    ? changelogs.map((entry): FeedItem => ({
        title: entry.title,
        description: entry.excerpt,
        pubDate: new Date(`${entry.date}T00:00:00Z`),
        link: entry.url,
        content: paragraphsHtml(entry.paragraphs, entry.excerpt),
      }))
    : [];

  const slackItems = slack.flatMap(({ column, messages }) => {
    // A column joining the feed with rssSince set starts from that date,
    // rather than replaying its history into subscribers' readers.
    const since = column.rssSince ? new Date(column.rssSince).getTime() : null;
    return (
      messages
        .map((message): FeedItem => ({
          title:
            firstMetadataValue(message.metadata) ??
            column.title ??
            "Slack message",
          description: column.title,
          pubDate: new Date(message.timestamp),
          link: `/slack/${encodeURIComponent(column.column)}/${encodeURIComponent(message.slackTs)}/`,
          content: `<p>${escapeHtml(message.text)}</p>`,
        }))
        // Indigest occasionally returns a malformed timestamp; drop those
        // rather than let one bad record break the whole feed.
        .filter((item) => !Number.isNaN(item.pubDate.getTime()))
        .filter((item) => since === null || item.pubDate.getTime() >= since)
    );
  });

  return [...postItems, ...changelogItems, ...slackItems].sort(
    (a, b) => b.pubDate.getTime() - a.pubDate.getTime(),
  );
}
