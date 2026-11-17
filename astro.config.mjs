import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import vercel from "@astrojs/vercel";
import mdx from "@astrojs/mdx";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { legacyRedirects } from "./src/data/legacy-redirects.mjs";

// CMS=emdash swaps the MDX files in src/content for EmDash as the source of
// posts, changelogs and pages. This setup uses SQLite on a local disk and a
// long-running Node server, which Vercel does not offer, so the Vercel build
// keeps reading the files.
const useEmDash = process.env.CMS === "emdash";
if (useEmDash && process.env.VERCEL) {
  throw new Error(
    "CMS=emdash is set up for the Node adapter, with SQLite on a local disk. It has not been configured for Vercel.",
  );
}

// Vite inlines `import.meta.env.X` while building. A Docker image is built
// once and configured when it starts, so there these are read from the
// process environment instead, which also keeps secrets out of the image.
const RUNTIME_ENV = [
  "AUTH_SECRET",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "HACKCLUB_CLIENT_ID",
  "HACKCLUB_CLIENT_SECRET",
  "INDIGEST_API_KEY",
  "INDIGEST_API_URL",
  "INDIGEST_CACHE_TTL_MS",
  "RSS_ACCESS_TOKEN",
];
// In `astro dev` the browser would receive these too, and it has no `process`,
// so the admin would not start. Dev reads .env through Vite instead.
const isDev = process.argv.includes("dev");
const runtimeEnv = Object.fromEntries(
  RUNTIME_ENV.map((name) => [`import.meta.env.${name}`, `process.env.${name}`]),
);

// ...which means `astro dev` no longer gets them from .env through Vite.
if (useEmDash && existsSync(".env")) process.loadEnvFile(".env");

// Sign in to the EmDash admin with Hack Club Auth. The routes decide who is let
// in; see src/cms/hackclub-auth/routes/callback.ts.
const hackClubAuthFile = (name) =>
  fileURLToPath(new URL(`./src/cms/hackclub-auth/${name}`, import.meta.url));
const hackClubAuth = {
  id: "hackclub",
  label: "Hack Club",
  adminEntry: hackClubAuthFile("admin.tsx"),
  routes: [
    {
      pattern: "/_emdash/api/auth/hackclub/login",
      entrypoint: hackClubAuthFile("routes/login.ts"),
    },
    {
      pattern: "/_emdash/api/auth/hackclub/callback",
      entrypoint: hackClubAuthFile("routes/callback.ts"),
    },
  ],
  publicRoutes: ["/_emdash/api/auth/hackclub/"],
};

// Review requests, comments, approvals by named editors, and a gate that keeps
// an article from going live until the exact text was approved. See
// src/cms/newsroom/plugin.ts.
const reviewable = ["posts", "changelogs", "pages"];
const newsroom = {
  id: "newsroom",
  version: "0.2.0",
  entrypoint: fileURLToPath(
    new URL("./src/cms/newsroom/plugin.ts", import.meta.url),
  ),
  // The text editor with comments and suggestions on selected passages.
  adminEntry: fileURLToPath(
    new URL("./src/cms/newsroom/admin.tsx", import.meta.url),
  ),
  fieldWidgets: [
    {
      name: "review-text",
      label: "Text with comments and suggestions",
      fieldTypes: ["text"],
    },
  ],
  adminPages: [
    { path: "/queue", label: "Review queue", icon: "inbox" },
    { path: "/calendar", label: "Calendar", icon: "calendar" },
  ],
  adminWidgets: [{ id: "awaiting", size: "third", title: "Awaiting review" }],
  editorPanels: [
    {
      id: "review",
      title: "Review",
      route: "panel",
      collections: reviewable,
      draft: { read: { fields: ["body"] } },
    },
  ],
  editorActions: [
    {
      id: "submit",
      label: "Submit for review",
      route: "submit",
      placement: "toolbar",
      collections: reviewable,
    },
    {
      id: "approve",
      label: "Approve",
      route: "approve",
      placement: "toolbar",
      collections: reviewable,
      confirm: {
        title: "Approve this article?",
        text: "You approve the text as it is now. Any edit sends it back to review.",
        confirm: "Approve",
        deny: "Cancel",
      },
    },
  ],
  settingsSchema: {
    collections: {
      type: "string",
      label: "Collections that need review",
      description:
        "Comma-separated collection slugs. Posts, changelogs and pages are supported.",
      default: "posts",
    },
    requiredApprovals: {
      type: "number",
      label: "Approvals needed",
      description:
        "How many different editors must approve before publishing (1 to 5).",
      default: 1,
      min: 1,
      max: 5,
    },
    approvers: {
      type: "string",
      label: "Approvers",
      description:
        "Emails or user IDs, separated by commas. Leave empty to let any editor approve. Administrators can always approve.",
      multiline: true,
    },
    notify: {
      type: "boolean",
      label: "Send email",
      description:
        "Tell approvers when an article is sent for review, and the author when it is decided. Needs an email provider.",
      default: true,
    },
  },
};

const contentSource = (name) =>
  fileURLToPath(
    new URL(`./src/lib/content-source/${name}.ts`, import.meta.url),
  );

async function emdashIntegrations() {
  const [{ default: react }, { default: emdash, local }, { sqlite }] =
    await Promise.all([
      import("@astrojs/react"),
      import("emdash/astro"),
      import("emdash/db"),
    ]);
  // Relative to the directory the server starts in. The Docker image mounts a
  // volume here.
  const dataDir = "./data";
  return [
    react(),
    emdash({
      database: sqlite({ url: `file:${dataDir}/emdash.db` }),
      storage: local({
        directory: `${dataDir}/uploads`,
        baseUrl: "/_emdash/api/media/file",
      }),
      // Sandboxed plugins run in a local workerd child process, the
      // open-source Workers runtime. Nothing is hosted on Cloudflare.
      sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox",
      authProviders: [hackClubAuth],
      plugins: [newsroom],
      // Several people can edit one article at once. Needs the Node server,
      // not a cluster of workers.
      coEditing: true,
    }),
    {
      name: "slacker-news:cms-routes",
      hooks: {
        "astro:route:setup": ({ route }) => {
          // Content lives in the database, so nothing that reads it can be
          // rendered at build time.
          if (route.component.endsWith("src/pages/changelogs/[slug].astro")) {
            route.prerender = false;
          }
        },
      },
    },
  ];
}

export default defineConfig({
  site: "https://news.hackclub.com",
  output: "server",
  adapter: process.env.VERCEL ? vercel() : node({ mode: "standalone" }),
  server: { port: 4000 },
  markdown: {
    remarkPlugins: [[remarkMath, { singleDollarTextMath: false }]],
    rehypePlugins: [rehypeKatex],
  },
  integrations: [mdx(), ...(useEmDash ? await emdashIntegrations() : [])],
  image: {
    domains: ["cdn.hackclub.com", "user-cdn.hackclub-assets.com"],
  },
  redirects: legacyRedirects,
  vite: {
    define: useEmDash && !isDev ? runtimeEnv : {},
    resolve: {
      alias: {
        "#content-source": contentSource(useEmDash ? "emdash" : "file"),
        "#live-loader": contentSource(useEmDash ? "live-emdash" : "live-none"),
      },
    },
  },
});
