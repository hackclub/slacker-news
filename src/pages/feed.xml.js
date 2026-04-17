import rss from "@astrojs/rss";
import { getPosts, getSiteConfig } from "../lib/content";

export async function GET(context) {
    const site = await getSiteConfig();
    const posts = await getPosts();

    return rss({
        title: site.title,
        description: site.description,
        site: context.site,
        items: posts.map((post) => ({
            title: post.title,
            description: post.excerpt,
            pubDate: post.date,
            link: post.url
        }))
    });
}
