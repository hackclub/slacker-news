/**
 * Migrates the MDX files in src/content into an EmDash seed file.
 *
 *   bun scripts/build-emdash-seed.ts            # writes seed/seed.json
 *   bunx emdash seed seed/seed.json -d data/emdash.db
 *
 * The seed holds the content model (collections and fields) and one published
 * entry per MDX file. Applying it skips entries that already exist, so it is
 * safe to re-run against a database editors have been working in.
 *
 * src/lib/content-source/emdash.ts reads these fields back; change the two
 * together.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseFrontmatter } from "@astrojs/markdown-remark";
import { slug as slugify } from "github-slugger";
import siteData from "../src/data/site.json";

const CONTENT_DIR = "src/content";
const OUT_FILE = process.argv[2] ?? "seed/seed.json";
const POST_CATEGORIES = ["news", "opinion", "essays"];

const COMPONENT_IMPORT =
  /^import\s+\w+\s+from\s+["'][^"']*\/components\/\w+\.astro["'];?[ \t]*\r?\n/gm;

type Entry = {
  id: string;
  slug: string;
  status: "published";
  data: Record<string, unknown>;
};

/** A list in frontmatter becomes "a, b" in the CMS, where each field is one text box. */
function joined(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const items = (Array.isArray(value) ? value : [value]).map((item) =>
    String(item).trim(),
  );
  for (const item of items) {
    if (item.includes(","))
      throw new Error(
        `"${item}" contains a comma and cannot be stored in a list field`,
      );
  }
  return items.join(", ") || undefined;
}

/** Frontmatter dates are kept as written; YAML turns unquoted ones into Date objects. */
function dateString(value: unknown, file: string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" && !Number.isNaN(new Date(value).getTime()))
    return value;
  throw new Error(`${file}: unreadable date ${JSON.stringify(value)}`);
}

function withoutEmpty(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined),
  );
}

async function readMdx(dir: string) {
  const files = (await readdir(dir))
    .filter((name) => name.endsWith(".mdx"))
    .sort();
  return Promise.all(
    files.map(async (name) => {
      const file = join(dir, name);
      const { frontmatter, content } = parseFrontmatter(
        await readFile(file, "utf8"),
      );
      return {
        file,
        // The same slugging Astro's glob loader applies, so URLs do not change.
        slug: slugify(basename(name, ".mdx")),
        frontmatter: frontmatter as Record<string, unknown>,
        body: content.replace(COMPONENT_IMPORT, "").replace(/^\s*\n/, ""),
      };
    }),
  );
}

const posts: Entry[] = [];
for (const category of POST_CATEGORIES) {
  for (const { file, slug, frontmatter, body } of await readMdx(
    join(CONTENT_DIR, "posts", category),
  )) {
    posts.push({
      id: `post:${category}/${slug}`,
      slug,
      status: "published",
      data: withoutEmpty({
        title: frontmatter.title,
        date: dateString(frontmatter.date, file),
        category,
        author: joined(frontmatter.author),
        excerpt: frontmatter.excerpt,
        front_page_preview: frontmatter.frontPagePreview,
        response_to: joined(frontmatter.responseTo),
        follow_up_to: joined(frontmatter.followUpTo),
        legacy_id: frontmatter.id,
        body,
      }),
    });
  }
}

const duplicate = posts.find(
  (post, index) =>
    posts.findIndex((other) => other.slug === post.slug) !== index,
);
if (duplicate)
  throw new Error(
    `Two posts share the slug "${duplicate.slug}"; EmDash slugs are unique per collection`,
  );

const changelogs: Entry[] = (
  await readMdx(join(CONTENT_DIR, "posts", "changelogs"))
).map(({ file, slug, frontmatter, body }) => ({
  id: `changelog:${slug}`,
  slug,
  status: "published",
  data: withoutEmpty({
    title: frontmatter.title,
    date: dateString(frontmatter.date, file),
    author: joined(frontmatter.author),
    excerpt: frontmatter.excerpt,
    response_to: joined(frontmatter.responseTo),
    follow_up_to: joined(frontmatter.followUpTo),
    body,
  }),
}));

const pages: Entry[] = (await readMdx(join(CONTENT_DIR, "pages"))).map(
  ({ slug, frontmatter, body }) => ({
    id: `page:${slug}`,
    slug,
    status: "published",
    data: withoutEmpty({ title: frontmatter.title, body }),
  }),
);

const title = {
  slug: "title",
  label: "Title",
  type: "string",
  required: true,
  searchable: true,
};
const date = {
  slug: "date",
  label: "Date",
  type: "string",
  required: true,
  options: { helpText: "YYYY-MM-DD, optionally followed by a time." },
};
const author = {
  slug: "author",
  label: "Author",
  type: "string",
  options: {
    helpText:
      "A Slack handle such as @orpheus. Separate several authors with commas.",
  },
};
const excerpt = {
  slug: "excerpt",
  label: "Excerpt",
  type: "text",
  options: { rows: 3 },
};
const references = [
  {
    slug: "response_to",
    label: "Response to",
    type: "string",
    options: {
      helpText:
        "Slugs of the posts this responds to, such as news/red-teams. Separate several with commas.",
    },
  },
  {
    slug: "follow_up_to",
    label: "Follow-up to",
    type: "string",
    options: {
      helpText:
        "Slugs of the posts this follows up on. Separate several with commas.",
    },
  },
];
const body = {
  slug: "body",
  label: "Body (MDX)",
  type: "text",
  searchable: true,
  options: {
    rows: 30,
    helpText:
      "Markdown, plus the components Caption, Emoji, M, RawHtml, SlackChannel, SlackMention and YouTube. No imports needed.",
  },
};
const supports = ["drafts", "revisions", "search"];

const seed = {
  $schema: "https://emdashcms.com/seed.schema.json",
  version: "1",
  meta: {
    name: "Slacker News",
    description:
      "Content model and articles migrated from the MDX files in src/content.",
  },
  settings: { title: siteData.title, tagline: siteData.description },
  collections: [
    {
      slug: "posts",
      label: "Posts",
      labelSingular: "Post",
      sortOrder: 1,
      supports,
      fields: [
        title,
        date,
        {
          slug: "category",
          label: "Category",
          type: "select",
          required: true,
          defaultValue: "news",
          validation: { options: POST_CATEGORIES },
        },
        author,
        excerpt,
        {
          slug: "front_page_preview",
          label: "Front page preview",
          type: "text",
          options: {
            rows: 6,
            helpText:
              "Shown instead of the opening paragraphs when this post is the headline.",
          },
        },
        ...references,
        {
          slug: "members_only",
          label: "Members only",
          type: "boolean",
          defaultValue: false,
          options: {
            helpText:
              "Readers must sign in with Hack Club to read this. It is left out of the front page, archives, search and RSS for everyone else.",
          },
        },
        { slug: "legacy_id", label: "Legacy ID", type: "string" },
        body,
      ],
    },
    {
      slug: "changelogs",
      label: "Changelogs",
      labelSingular: "Changelog",
      urlPattern: "/changelogs/{slug}",
      sortOrder: 2,
      supports,
      fields: [
        title,
        date,
        { ...author, required: true },
        excerpt,
        ...references,
        body,
      ],
    },
    {
      slug: "pages",
      label: "Pages",
      labelSingular: "Page",
      urlPattern: "/{slug}",
      sortOrder: 3,
      supports,
      fields: [{ ...title, required: false }, body],
    },
  ],
  content: { posts, changelogs, pages },
};

await mkdir(join(OUT_FILE, ".."), { recursive: true });
await writeFile(OUT_FILE, `${JSON.stringify(seed, null, 2)}\n`);
console.log(
  `${OUT_FILE}: ${posts.length} posts, ${changelogs.length} changelogs, ${pages.length} pages`,
);
