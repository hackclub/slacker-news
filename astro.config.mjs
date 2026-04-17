import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";

export default defineConfig({
    site: "https://news.hackclub.com",
    integrations: [mdx()],
    redirects: {
        "/3-months-at-hack-club": "/opinion/3-months-at-hack-club",
        "/against-moderation-transparency": "/opinion/against-moderation-transparency",
        "/better-goodbye": "/opinion/better-goodbye",
        "/community-privacy-policy": "/news/community-privacy-policy",
        "/confessions-new-owners": "/news/confessions-new-owners",
        "/how-to-get-a-gap-year": "/opinion/how-to-get-a-gap-year",
        "/introducing-mole": "/news/introducing-mole",
        "/nasa-stardance": "/news/nasa-stardance",
        "/new-hq": "/news/new-hq",
        "/prometheus-distributed-care": "/news/prometheus-distributed-care",
        "/prometheus-mole": "/opinion/prometheus-mole",
        "/quality-integrity-manager": "/essays/quality-integrity-manager",
        "/set-your-own-manager": "/news/set-your-own-manager",
        "/slack-readme": "/news/slack-readme",
        "/slack-survey": "/news/slack-survey",
        "/three-futures-slack": "/essays/three-futures-slack",
        "/tragedy-anticommons": "/opinion/tragedy-anticommons",
        "/transparency-debate": "/news/transparency-debate",
        "/welcome-to-slacker-news": "/news/welcome-to-slacker-news"
    }
});
