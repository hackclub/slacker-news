// Prints the link (the GUID readers track) and date of every item /feed.xml
// would carry for each case in a cases file, as JSON. CI runs this on both
// sides of a pull request and compares them with check-feed-retroactive.ts.
//
// Usage: bun scripts/feed-guids.ts <cases.json>
//
// Posts, changelogs, Slack column config and legacy redirects come from this
// checkout. Slack messages come from Indigest in production, so every column
// gets the same generated history instead: that way a config change that
// exposes a column's past messages shows up as old items appearing.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import columnConfig from "../src/data/slack-columns.json";
import { legacyRedirects } from "../src/data/legacy-redirects.mjs";
import {
  buildFeedItems,
  getFeedSelection,
  getFeedSlackColumns,
  type FeedChangelog,
  type FeedPost,
} from "../src/lib/feed-items";
import type { SlackColumnConfig } from "../src/lib/indigest";

type FeedCase = { name: string; query: string; member?: boolean };

const root = join(import.meta.dir, "..");
const postsDir = join(root, "src/content/posts");

function listMdx(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listMdx(path);
    return entry.name.endsWith(".mdx") ? [path] : [];
  });
}

// Only the fields the feed's links and dates depend on.
function frontmatter(path: string): Record<string, string> {
  const match = readFileSync(path, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fields: Record<string, string> = {};
  for (const line of match?.[1].split(/\r?\n/) ?? []) {
    const field = line.match(/^(\w+):\s*(.*)$/);
    if (field)
      fields[field[1]] = field[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return fields;
}

function entryId(path: string, base: string): string {
  return relative(base, path)
    .replace(/\.mdx$/, "")
    .toLowerCase();
}

function loadPosts(): FeedPost[] {
  return ["essays", "news", "opinion"].flatMap((category) =>
    listMdx(join(postsDir, category)).map((path) => {
      const data = frontmatter(path);
      const slug = entryId(path, postsDir);
      return {
        slug,
        url: `/${slug}/`,
        title: data.title ?? slug,
        excerpt: "",
        date: new Date(data.date),
        category,
        paragraphs: [],
      };
    }),
  );
}

function loadChangelogs(): FeedChangelog[] {
  const base = join(postsDir, "changelogs");
  return listMdx(base).map((path) => {
    const data = frontmatter(path);
    const slug = entryId(path, base);
    return {
      url: `/changelogs/${slug}/`,
      title: data.title ?? slug,
      excerpt: "",
      date: new Date(data.date).toISOString().slice(0, 10),
      paragraphs: [],
    };
  });
}

// One message per column on the 15th of every month from January 2024 to
// December 2026. Fixed dates keep both sides of a comparison identical.
function sampleMessages(column: SlackColumnConfig) {
  const messages = [];
  for (let month = 0; month < 36; month++) {
    const date = new Date(Date.UTC(2024, month, 15, 12));
    const slackTs = `${Math.floor(date.getTime() / 1000)}.000100`;
    messages.push({
      slackTs,
      channelId: column.channelId ?? column.column,
      userId: "U0SAMPLE",
      userName: "sample",
      text: `Sample message from ${column.column}`,
      timestamp: date.toISOString(),
    });
  }
  return messages;
}

const casesPath = process.argv[2];
if (!casesPath) {
  console.error("Usage: bun scripts/feed-guids.ts <cases.json>");
  process.exit(2);
}
const cases: FeedCase[] = JSON.parse(readFileSync(casesPath, "utf8"));

const posts = loadPosts();
const changelogs = loadChangelogs();
const columns = columnConfig as SlackColumnConfig[];
const legacyPaths = new Set(
  Object.keys(legacyRedirects).map((path) => path.replace(/\/$/, "")),
);

const output: Record<string, { guid: string; date: string }[]> = {};
for (const feedCase of cases) {
  const wants = getFeedSelection(new URLSearchParams(feedCase.query));
  const slack = getFeedSlackColumns(columns, wants, () =>
    Boolean(feedCase.member),
  ).map((column) => ({ column, messages: sampleMessages(column) }));
  output[feedCase.name] = buildFeedItems({
    posts,
    changelogs,
    slack,
    wants,
    legacyPaths,
  }).map((item) => ({ guid: item.link, date: item.pubDate.toISOString() }));
}

console.log(JSON.stringify(output, null, 2));
