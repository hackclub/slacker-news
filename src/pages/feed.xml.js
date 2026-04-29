import rss from "@astrojs/rss";
import { getPosts, getSiteConfig } from "../lib/content";
import { legacyRedirects } from "../data/legacy-redirects.mjs";

const legacyPaths = new Set(Object.keys(legacyRedirects).map((path) => path.replace(/\/$/, "")));

export async function GET(context) {
    const site = await getSiteConfig();
    const posts = await getPosts();

    return rss({
        title: site.title,
        description: site.description,
        site: context.site,
        items: posts.map((post) => {
            const baseSlug = post.slug.split("/").pop();
            const legacyKey = baseSlug ? `/${baseSlug}` : null;
            const legacyLink = legacyKey && legacyPaths.has(legacyKey) ? `${legacyKey}/` : post.url;

            return {
                title: post.title,
                description: post.excerpt,
                pubDate: post.date,
                link: legacyLink
            };
        })
    });
}
