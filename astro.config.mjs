import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import mdx from "@astrojs/mdx";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { legacyRedirects } from "./src/data/legacy-redirects.mjs";

export default defineConfig({
    site: "https://news.hackclub.com",
    output: "server",
    adapter: node({ mode: "standalone" }),
    server: { port: 4000 },
    markdown: {
        remarkPlugins: [[remarkMath, { singleDollarTextMath: false }]],
        rehypePlugins: [rehypeKatex],
    },
    integrations: [mdx()],
    image: {
        domains: ["cdn.hackclub.com", "user-cdn.hackclub-assets.com"]
    },
    redirects: legacyRedirects
});
