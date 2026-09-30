import rss from "@astrojs/rss";
import { timingSafeEqual } from "node:crypto";
import { getChangelogEntries, getPosts, getSiteConfig } from "../lib/content";
import { legacyRedirects } from "../data/legacy-redirects.mjs";
import {
  firstMetadataValue,
  getSlackColumnData,
  getSlackColumns,
} from "../lib/indigest";
import { getFeedTokenStatus } from "../lib/feed-tokens";

const legacyPaths = new Set(
  Object.keys(legacyRedirects).map((path) => path.replace(/\/$/, "")),
);

function isLegacyRssToken(provided) {
  const expected = import.meta.env.RSS_ACCESS_TOKEN;
  if (!expected) return false;

  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;

  return timingSafeEqual(expectedBuf, providedBuf);
}

// Which protected Slack columns the ?token= may read: every one for the
// shared legacy token, those in scope of a reader's Indigest feed token, or,
// for a revoked feed token, none plus a notice.
async function getTokenAccess(context) {
  const token = context.url.searchParams.get("token");
  if (!token) return { canRead: () => false };
  if (isLegacyRssToken(token)) return { canRead: () => true };

  const status = await getFeedTokenStatus(token).catch((error) => {
    console.error("Unable to validate feed token", error);
    return { status: "unknown" };
  });
  if (status.status === "revoked") {
    return { canRead: () => false, revokedAt: status.revokedAt };
  }
  if (status.status !== "active") return { canRead: () => false };
  return {
    canRead: (column) =>
      status.channelIds.includes(column.channelId ?? column.column),
  };
}

// The feed carries its defaults (every article category plus the Slack
// columns marked rss), adjusted by ?exclude= and ?include=, as built on /rss/.
// Ids are article categories (news, opinion, essays, changelogs) and
// slack-<column>. Links only name departures from the defaults, so changing
// a default later reaches existing subscribers.
function listParam(context, name) {
  return new Set(
    (context.url.searchParams.get(name) ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

function getColumnSelection(context) {
  const include = listParam(context, "include");
  const exclude = listParam(context, "exclude");
  return (id, isDefault) => (isDefault || include.has(id)) && !exclude.has(id);
}

function getFeedSlackColumns(wants, tokenAccess) {
  return getSlackColumns().filter(
    (column) =>
      wants(`slack-${column.column}`, Boolean(column.rss)) &&
      (!column.authRequired || tokenAccess.canRead(column)),
  );
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// Keys revoked before Indigest recorded revocation times have no date, so
// their notices fall on Mondays.
const FALLBACK_REVOKED_AT = new Date(Date.UTC(1970, 0, 5));

// Tell a reader still polling a revoked link how to get a new one. The notice
// is a fresh item once a week, counted from the revocation.
function revokedTokenNotice(context, revokedAt) {
  const anchor = (revokedAt ?? FALLBACK_REVOKED_AT).getTime();
  const week = Math.max(0, Math.floor((Date.now() - anchor) / WEEK_MS));
  const loginUrl = new URL("/rss/", context.site ?? context.url).toString();
  const message = `Your key is revoked. Log in to ${loginUrl} to make a new one.`;

  return {
    title: "Your key is revoked",
    description: message,
    pubDate: new Date(anchor + week * WEEK_MS),
    // The link doubles as the item's GUID, so it changes every week. It is
    // absolute so @astrojs/rss leaves it alone instead of adding a slash.
    link: `${loginUrl}#revoked-${week}`,
    content: `<p>Your key is revoked. Log in to <a href="${loginUrl}">${loginUrl}</a> to make a new one.</p>`,
  };
}

async function getSlackItems(columns) {
  const columnData = await Promise.all(
    columns.map((column) => getSlackColumnData(column.column)),
  );

  return columnData
    .filter((column) => column !== undefined)
    .flatMap((column) =>
      column.messages
        .map((message) => ({
          title:
            firstMetadataValue(message.metadata) ?? column.title ?? "Slack message",
          description: column.title,
          pubDate: new Date(message.timestamp),
          link: `/slack/${encodeURIComponent(column.column)}/${encodeURIComponent(message.slackTs)}/`,
          content: `<p>${escapeHtml(message.text)}</p>`,
        }))
        // Indigest occasionally returns a malformed timestamp; drop those
        // rather than let one bad record break the whole feed.
        .filter((item) => !Number.isNaN(item.pubDate.getTime())),
    );
}

function escapeHtml(input) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function trackFeedView(context) {
  if (import.meta.env.DEV || !context.site || context.isPrerendered) {
    return;
  }

  const feedUrl = new URL("/feed.xml", context.site).toString();
  const siteDomain = new URL(context.site).hostname;
  const headers = context.request.headers;
  const userAgent = headers.get("user-agent") ?? undefined;
  const acceptLanguage = headers.get("accept-language") ?? undefined;
  const referer = headers.get("referer") ?? undefined;
  const forwardedFor =
    headers.get("x-forwarded-for") ??
    headers.get("cf-connecting-ip") ??
    context.clientAddress ??
    undefined;

  await fetch("https://plausible.io/api/event", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(userAgent ? { "User-Agent": userAgent } : {}),
      ...(acceptLanguage ? { "Accept-Language": acceptLanguage } : {}),
      ...(referer ? { Referer: referer } : {}),
      ...(forwardedFor ? { "X-Forwarded-For": forwardedFor } : {}),
    },
    body: JSON.stringify({
      name: "pageview",
      url: feedUrl,
      domain: siteDomain,
    }),
  }).catch(() => {});
}

export async function GET(context) {
  const site = await getSiteConfig();
  const posts = await getPosts();
  const changelogs = await getChangelogEntries();
  const wants = getColumnSelection(context);
  const tokenAccess = await getTokenAccess(context);
  const slackItems = await getSlackItems(
    getFeedSlackColumns(wants, tokenAccess),
  );
  if ("revokedAt" in tokenAccess) {
    slackItems.push(revokedTokenNotice(context, tokenAccess.revokedAt));
  }

  await trackFeedView(context);

  const postItems = posts
    .filter((post) => wants(post.category, true))
    .map((post) => {
    const baseSlug = post.slug.split("/").pop();
    const legacyKey = baseSlug ? `/${baseSlug}` : null;
    const legacyLink =
      legacyKey && legacyPaths.has(legacyKey) ? `${legacyKey}/` : post.url;
    const leadingImageSrc =
      post.leadingImage?.src ??
      "https://cdn.hackclub.com/019dbae9-5242-745b-acd2-3476ab3c52a3/og-default.png";
    const leadingImageAlt =
      post.leadingImage?.alt ?? `Slacker News social preview`;

    const paragraphContent = post.paragraphs.length
      ? post.paragraphs
          .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
          .join("")
      : `<p>${escapeHtml(post.excerpt)}</p>`;

    return {
      title: post.title,
      description: post.excerpt,
      pubDate: post.date,
      link: legacyLink,
      content: paragraphContent,

      // @astrojs/rss doesn't support Media RSS
      customData: `
                <media:content url="${leadingImageSrc}" medium="image" />
                <media:thumbnail url="${leadingImageSrc}" />
                <media:title type="plain">${leadingImageAlt}</media:title>
            `,
    };
  });

  const longChangelogItems = changelogs
    .filter(
      (entry) =>
        entry.kind === "long" && wants("changelogs", true),
    )
    .map((entry) => {
      const paragraphContent = entry.paragraphs.length
        ? entry.paragraphs
            .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
            .join("")
        : `<p>${escapeHtml(entry.excerpt)}</p>`;

      return {
        title: entry.title,
        description: entry.excerpt,
        pubDate: new Date(`${entry.date}T00:00:00Z`),
        link: entry.url,
        content: paragraphContent,
      };
    });

  const items = [...postItems, ...longChangelogItems, ...slackItems].sort(
    (a, b) => b.pubDate.getTime() - a.pubDate.getTime(),
  );

  return rss({
    title: site.title,
    description: site.description,
    site: context.site,
    xmlns: {
      media: "http://search.yahoo.com/mrss/",
    },
    items,
  });
}
