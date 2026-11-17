#!/usr/bin/env node
/**
 * Copies the articles of a Slack markdown column into the EmDash database, as
 * members-only posts.
 *
 *   INDIGEST_API_KEY=... node scripts/import-slack-column.mjs <channel id> [database]
 *
 * This is for retiring a protected Slack column: once its articles are in the
 * CMS, the column can be removed from src/data/slack-columns.json. It runs
 * where the database is, because protected articles must not pass through the
 * repository or the Docker image. It is plain Node so it can run in the
 * container, which has no Bun.
 *
 * Articles keep their URL. One whose slug is already taken by a post is
 * skipped and reported, as is a message that does not name a title and one of
 * the site's columns. The rules for reading a message as an article are those
 * of getSlackArticle() in src/lib/indigest.ts.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [channel, database = "data/emdash.db"] = process.argv.slice(2);
const apiKey = process.env.INDIGEST_API_KEY;
if (!channel || !apiKey) {
  console.error(
    "Usage: INDIGEST_API_KEY=... node scripts/import-slack-column.mjs <channel id> [database]",
  );
  process.exit(1);
}

const MARKDOWN_COLUMNS = ["news", "opinion", "essays"];

function metadataOf(message) {
  const { metadata } = message;
  if (metadata && typeof metadata === "object") return metadata;
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

// Matches "publishdate", "publish_date", "Publish Date" and so on.
const fieldName = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

function field(metadata, name) {
  const entry = Object.entries(metadata).find(
    ([key]) => fieldName(key) === name,
  );
  const value = entry?.[1];
  if (typeof value === "string") return value.trim() || undefined;
  return value === undefined || value === null ? undefined : String(value);
}

function slugify(text) {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// A publish date is a day, epoch seconds, or anything Date understands. A
// bare day is read at noon UTC so it shows as that day in every US timezone.
function publishDate(value) {
  if (!value) return undefined;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00Z`)
    : /^\d+$/.test(value)
      ? new Date(Number(value) * 1000)
      : new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function messageDate(message) {
  const parsed = new Date(message.timestamp);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  for (const value of [message.timestamp, message.slackTs]) {
    const seconds = Number(value);
    if (value && Number.isFinite(seconds)) return new Date(seconds * 1000);
  }
  return new Date(NaN);
}

const url = new URL(
  "/api/messages",
  process.env.INDIGEST_API_URL ?? "https://indigest.matmanna.dev",
);
url.searchParams.set("channel", channel);
url.searchParams.set("limit", "10000");
const response = await fetch(url, {
  headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
});
if (!response.ok) {
  console.error(`Indigest returned ${response.status} for channel ${channel}`);
  process.exit(1);
}
const messages = (await response.json()).data ?? [];

const db = new DatabaseSync(database, { readOnly: true });
const taken = new Set(
  db
    .prepare("select slug from ec_posts")
    .all()
    .map((row) => row.slug),
);
db.close();

const posts = [];
const skipped = [];
for (const message of messages) {
  const metadata = metadataOf(message);
  const title = field(metadata, "title");
  const category = field(metadata, "column")?.toLowerCase();
  if (!title || !category || !MARKDOWN_COLUMNS.includes(category)) {
    skipped.push(`${message.slackTs}: no title or site column`);
    continue;
  }

  const slug =
    slugify(field(metadata, "slug") ?? "") ||
    slugify(title) ||
    message.slackTs.replace(".", "-");
  if (taken.has(slug)) {
    skipped.push(`/${category}/${slug}/: a post with this slug already exists`);
    continue;
  }
  taken.add(slug);

  const date =
    publishDate(field(metadata, "publishdate")) ?? messageDate(message);
  if (Number.isNaN(date.getTime())) {
    skipped.push(`/${category}/${slug}/: no readable date`);
    continue;
  }

  posts.push({
    id: `slack:${channel}:${message.slackTs}`,
    slug,
    status: "published",
    data: {
      title,
      date: date.toISOString(),
      category,
      // Without a named author, the person who posted the message is the author.
      author: field(metadata, "author") ?? message.userId,
      members_only: true,
      body_format: "slack",
      body: message.formattedText || message.text,
    },
  });
}

for (const line of skipped) console.log(`Skipped ${line}`);
if (posts.length === 0) {
  console.log("Nothing to import.");
  process.exit(0);
}

// The EmDash CLI writes entries the way the admin does, revisions included.
const directory = mkdtempSync(join(tmpdir(), "slack-import-"));
try {
  const seedFile = join(directory, "seed.json");
  writeFileSync(seedFile, JSON.stringify({ version: "1", content: { posts } }));
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/emdash/dist/cli/index.mjs",
      "seed",
      seedFile,
      "--database",
      database,
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
} finally {
  rmSync(directory, { recursive: true, force: true });
}

// EmDash stamps new entries as published now. An imported article was
// published on its date, which is also where the admin calendar should show it.
const writable = new DatabaseSync(database);
const setPublished = writable.prepare(
  "update ec_posts set published_at = date where slug = ?",
);
for (const post of posts) {
  setPublished.run(post.slug);
  console.log(`Imported /${post.data.category}/${post.slug}/`);
}
writable.close();
