import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";

export default defineConfig({
    site: "https://news.hackclub.com",
    integrations: [mdx()],
    image: {
        domains: ["cdn.hackclub.com", "user-cdn.hackclub-assets.com"]
    }
});
