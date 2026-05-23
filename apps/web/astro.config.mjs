import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import { legacyRedirects } from "./src/data/legacy-redirects.mjs";

export default defineConfig({
    site: "https://news.hackclub.com",
    server: { port: 4000 },
    integrations: [mdx()],
    image: {
        domains: ["cdn.hackclub.com", "user-cdn.hackclub-assets.com"]
    },
    redirects: legacyRedirects
});
