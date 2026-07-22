import type { APIRoute } from "astro";
import { getPosts } from "../lib/content";
import { buildSearchIndex } from "../lib/search";

export const GET: APIRoute = async () => {
    const posts = await getPosts();
    const index = buildSearchIndex(posts);

    return new Response(JSON.stringify(index), {
        headers: { "content-type": "application/json" }
    });
};
