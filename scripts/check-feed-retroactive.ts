// Fails when a change would add old items to existing feeds. RSS readers show
// every GUID they have not seen as new, so an item that appears in a feed
// long after its date (a column joining the defaults, a changed link, a
// backdated post) floods subscribers with stale entries.
//
// Usage: bun scripts/check-feed-retroactive.ts <base.json> <head.json>
//
// Both files come from scripts/feed-guids.ts. An item in head but not in
// base must be dated within GRACE_DAYS of now; new posts pass, history does
// not. To add a Slack column to the feed, give it an rssSince date in
// src/data/slack-columns.json.
import { readFileSync } from "node:fs";

export const GRACE_DAYS = 14;

type FeedGuids = Record<string, { guid: string; date: string }[]>;

export function findRetroactiveItems(
  base: FeedGuids,
  head: FeedGuids,
  now = new Date(),
): { feed: string; guid: string; date: string }[] {
  const cutoff = now.getTime() - GRACE_DAYS * 24 * 60 * 60 * 1000;
  return Object.entries(head).flatMap(([feed, items]) => {
    // A feed case new in this change has no history to compare against.
    if (!(feed in base)) return [];
    const seen = new Set(base[feed].map((item) => item.guid));
    return items
      .filter((item) => !seen.has(item.guid))
      .filter((item) => new Date(item.date).getTime() < cutoff)
      .map((item) => ({ feed, ...item }));
  });
}

if (import.meta.main) {
  const [basePath, headPath] = process.argv.slice(2);
  if (!basePath || !headPath) {
    console.error(
      "Usage: bun scripts/check-feed-retroactive.ts <base.json> <head.json>",
    );
    process.exit(2);
  }
  const read = (path: string): FeedGuids =>
    JSON.parse(readFileSync(path, "utf8"));
  const found = findRetroactiveItems(read(basePath), read(headPath));

  if (found.length === 0) {
    console.log("No old items added to any feed.");
    process.exit(0);
  }

  console.error(
    `This change adds ${found.length} item(s) dated more than ${GRACE_DAYS} days ago to existing feeds.`,
  );
  console.error(
    "Readers would show them as new. To add a Slack column to the feed, set rssSince in src/data/slack-columns.json; otherwise keep old items' links and dates unchanged.\n",
  );
  const byFeed = Map.groupBy(found, (item) => item.feed);
  for (const [feed, items] of byFeed) {
    console.error(`${feed}: ${items.length} item(s)`);
    for (const item of items.slice(0, 10))
      console.error(`  ${item.date.slice(0, 10)}  ${item.guid}`);
    if (items.length > 10) console.error(`  … and ${items.length - 10} more`);
  }
  process.exit(1);
}
