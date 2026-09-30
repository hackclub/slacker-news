import { describe, expect, test } from "bun:test";
import {
  buildFeedItems,
  getFeedSelection,
  getFeedSlackColumns,
  type FeedPost,
} from "../src/lib/feed-items";
import type { SlackColumnConfig } from "../src/lib/indigest";
import { findRetroactiveItems } from "../scripts/check-feed-retroactive";

const select = (query: string) => getFeedSelection(new URLSearchParams(query));

const columns: SlackColumnConfig[] = [
  { column: "ysws", title: "YSWS", rss: true },
  {
    column: "opinion",
    title: "Protected Opinions",
    rss: true,
    authRequired: true,
  },
  { column: "extra", title: "Extra" },
];

const post = (slug: string, date: string): FeedPost => ({
  slug,
  url: `/${slug}/`,
  title: slug,
  excerpt: "",
  date: new Date(date),
  category: slug.split("/")[0],
  paragraphs: [],
});

const message = (slackTs: string, timestamp: string) => ({
  slackTs,
  channelId: "C1",
  userId: "U1",
  userName: "someone",
  text: "hi",
  timestamp,
});

describe("feed selection", () => {
  test("defaults apply without parameters", () => {
    const wants = select("");
    expect(wants("news", true)).toBe(true);
    expect(wants("slack-extra", false)).toBe(false);
  });

  test("exclude removes defaults and include adds others", () => {
    const wants = select("exclude=news&include=slack-extra");
    expect(wants("news", true)).toBe(false);
    expect(wants("opinion", true)).toBe(true);
    expect(wants("slack-extra", false)).toBe(true);
  });

  test("includeOnly ignores defaults and exclude", () => {
    const wants = select("includeOnly&include=news&exclude=news");
    expect(wants("news", true)).toBe(true);
    expect(wants("opinion", true)).toBe(false);
  });

  test("includeOnly=0 and includeOnly=false are off", () => {
    expect(select("includeOnly=0")("news", true)).toBe(true);
    expect(select("includeOnly=false")("news", true)).toBe(true);
  });

  test("members-only columns need read access", () => {
    const wants = select("");
    const names = (canRead: boolean) =>
      getFeedSlackColumns(columns, wants, () => canRead).map((c) => c.column);
    expect(names(false)).toEqual(["ysws"]);
    expect(names(true)).toEqual(["ysws", "opinion"]);
  });
});

describe("feed items", () => {
  const legacyPaths = new Set(["/old-post"]);

  test("posts that had a legacy path keep it as their link", () => {
    const items = buildFeedItems({
      posts: [
        post("news/old-post", "2026-01-01"),
        post("news/new-post", "2026-02-01"),
      ],
      changelogs: [],
      slack: [],
      wants: select(""),
      legacyPaths,
    });
    expect(items.map((item) => item.link)).toEqual([
      "/news/new-post/",
      "/old-post/",
    ]);
  });

  test("rssSince drops a column's messages from before it joined the feed", () => {
    const items = buildFeedItems({
      posts: [],
      changelogs: [],
      slack: [
        {
          column: {
            column: "ysws",
            title: "YSWS",
            rss: true,
            rssSince: "2026-06-01",
          },
          messages: [
            message("1.0", "2026-05-31T23:59:59Z"),
            message("2.0", "2026-06-01T00:00:00Z"),
          ],
        },
      ],
      wants: select(""),
      legacyPaths,
    });
    expect(items.map((item) => item.link)).toEqual(["/slack/ysws/2.0/"]);
  });
});

describe("retroactive feed check", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  const base = {
    default: [{ guid: "/news/a/", date: "2026-01-01T00:00:00Z" }],
  };

  test("passes new items dated recently", () => {
    const head = {
      default: [
        ...base.default,
        { guid: "/news/b/", date: "2026-09-28T00:00:00Z" },
      ],
    };
    expect(findRetroactiveItems(base, head, now)).toEqual([]);
  });

  test("flags old items that newly appear", () => {
    const head = {
      default: [
        ...base.default,
        { guid: "/slack/ysws/1.0/", date: "2025-03-15T00:00:00Z" },
      ],
    };
    expect(findRetroactiveItems(base, head, now)).toEqual([
      {
        feed: "default",
        guid: "/slack/ysws/1.0/",
        date: "2025-03-15T00:00:00Z",
      },
    ]);
  });

  test("flags an old item whose link changed", () => {
    const head = {
      default: [{ guid: "/news/a-renamed/", date: "2026-01-01T00:00:00Z" }],
    };
    expect(findRetroactiveItems(base, head, now)).toHaveLength(1);
  });

  test("allows removals and feed cases new to the change", () => {
    const head = {
      default: [],
      "new case": [{ guid: "/news/a/", date: "2026-01-01T00:00:00Z" }],
    };
    expect(findRetroactiveItems(base, head, now)).toEqual([]);
  });
});
