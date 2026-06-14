import rss from "@astrojs/rss";
import { getChangelogEntries, getPosts, getSiteConfig } from "../lib/content";
import { legacyRedirects } from "../data/legacy-redirects.mjs";

export const prerender = false;

const legacyPaths = new Set(Object.keys(legacyRedirects).map((path) => path.replace(/\/$/, "")));

function escapeHtml(input) {
    return input
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

async function trackFeedView(context) {
    if (!context.site || context.isPrerendered) {
        return;
    }

    const feedUrl = new URL("/feed.xml", context.site).toString();
    const siteDomain = new URL(context.site).hostname;
    const headers = context.request.headers;
    const userAgent = headers.get("user-agent") ?? undefined;
    const acceptLanguage = headers.get("accept-language") ?? undefined;
    const referer = headers.get("referer") ?? undefined;
    const forwardedFor =
        headers.get("x-forwarded-for") ?? headers.get("cf-connecting-ip") ?? context.clientAddress ?? undefined;

    await fetch("https://plausible.io/api/event", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(userAgent ? { "User-Agent": userAgent } : {}),
            ...(acceptLanguage ? { "Accept-Language": acceptLanguage } : {}),
            ...(referer ? { Referer: referer } : {}),
            ...(forwardedFor ? { "X-Forwarded-For": forwardedFor } : {})
        },
        body: JSON.stringify({
            name: "pageview",
            url: feedUrl,
            domain: siteDomain
        })
    }).catch(() => {});
}

export async function GET(context) {
    const site = await getSiteConfig();
    const posts = await getPosts();
    const changelogs = await getChangelogEntries();

    await trackFeedView(context);

    const postItems = posts.map((post) => {
        const baseSlug = post.slug.split("/").pop();
        const legacyKey = baseSlug ? `/${baseSlug}` : null;
        const legacyLink = legacyKey && legacyPaths.has(legacyKey) ? `${legacyKey}/` : post.url;

        const paragraphContent = post.paragraphs.length
            ? post.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")
            : `<p>${escapeHtml(post.excerpt)}</p>`;

        return {
            title: post.title,
            description: post.excerpt,
            pubDate: post.date,
            link: legacyLink,
            content: paragraphContent
        };
    });

    const longChangelogItems = changelogs
        .filter((entry) => entry.kind === "long")
        .map((entry) => {
            const paragraphContent = entry.paragraphs.length
                ? entry.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")
                : `<p>${escapeHtml(entry.excerpt)}</p>`;

            return {
                title: entry.title,
                description: entry.excerpt,
                pubDate: new Date(`${entry.date}T00:00:00Z`),
                link: entry.url,
                content: paragraphContent
            };
        });

    const items = [...postItems, ...longChangelogItems].sort(
        (a, b) => b.pubDate.getTime() - a.pubDate.getTime()
    );

    return rss({
        title: site.title,
        description: site.description,
        site: context.site,
        items
    });
}
