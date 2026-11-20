/**
 * Migrates the MDX files in src/content into an EmDash seed file.
 *
 *   bun scripts/build-emdash-seed.ts            # writes seed/seed.json
 *   bunx emdash seed seed/seed.json -d data/emdash.db
 *
 * Three files are written next to each other:
 *
 *  - seed.json: the content model (collections and fields), the site's title
 *    and description, and one published entry per MDX file. For a new
 *    database. Applying it skips entries that already exist.
 *  - model.json: the content model alone. The container applies it on every
 *    start, with updates, so a field added here reaches a live site. It has no
 *    settings, so a title an editor changed is not put back.
 *  - short-changelogs.json: the one-line changelog entries from
 *    src/data/changelog.json, as changelogs with no body. Applied once by
 *    scripts/emdash-import-once.mjs, so an entry an editor deleted stays gone.
 *
 * src/lib/content-source/emdash.ts reads these fields back; change the two
 * together.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseFrontmatter } from "@astrojs/markdown-remark";
import { slug as slugify } from "github-slugger";
import siteData from "../src/data/site.json";
import shortChangelogData from "../src/data/changelog.json";

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
  /** Taxonomy name to term slugs. */
  taxonomies?: Record<string, string[]>;
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

/**
 * EmDash stores a date as an instant in UTC. Frontmatter has days
 * ("2026-06-23") and local times ("2026-04-01 10:57:00"); both are read as
 * UTC, which is how the site has been showing them.
 */
function dateString(value: unknown, file: string): string {
  let parsed = new Date(NaN);
  if (value instanceof Date) {
    parsed = value;
  } else if (typeof value === "string") {
    const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(value.trim());
    parsed = new Date(hasZone ? value : `${value.trim().replace(" ", "T")}Z`);
  }
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${file}: unreadable date ${JSON.stringify(value)}`);
  }
  return parsed.toISOString();
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
      // The category is a taxonomy term; it is the first part of the address.
      taxonomies: { category: [category] },
      data: withoutEmpty({
        title: frontmatter.title,
        date: dateString(frontmatter.date, file),
        author: joined(frontmatter.author),
        excerpt: frontmatter.excerpt,
        response_to: joined(frontmatter.responseTo),
        follow_up_to: joined(frontmatter.followUpTo),
        legacy_id: frontmatter.id,
        body_format: "mdx",
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
    body_format: "mdx",
    body,
  }),
}));

// One-line entries. A changelog with no body is drawn as one line, its title
// being the change, and gets no page of its own.
const shortChangelogs: Entry[] = shortChangelogData.map((entry) => {
  const slug = slugify(`${entry.date} ${entry.change}`);
  return {
    id: `changelog:${slug}`,
    slug,
    status: "published",
    data: withoutEmpty({
      title: entry.change,
      date: dateString(entry.date, "src/data/changelog.json"),
      author: joined(entry.author),
      body_format: "mdx",
      body: "",
    }),
  };
});

const pages: Entry[] = (await readMdx(join(CONTENT_DIR, "pages"))).map(
  ({ slug, frontmatter, body }) => ({
    id: `page:${slug}`,
    slug,
    status: "published",
    data: withoutEmpty({ title: frontmatter.title, body_format: "mdx", body }),
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
  type: "datetime",
  required: true,
};
// Kept for articles nobody has credited yet. Authors are the bylines in the
// editor's sidebar now (scripts/emdash-after-seed.mjs moved them there).
const author = {
  slug: "author",
  label: "Author",
  type: "string",
  widget: "newsroom:hidden",
  options: {
    field: "author",
    helpText: "Replaced by the bylines. Only read for articles that have none.",
  },
};
const excerpt = {
  slug: "excerpt",
  label: "Summary",
  type: "text",
  options: {
    rows: 4,
    helpText:
      "A short description for lists, search results and RSS: its first paragraph is used. If it has several paragraphs, the front page shows them all when this is the headline, instead of the opening paragraphs.",
  },
};
const references = [
  {
    slug: "response_to",
    label: "Response to",
    type: "string",
    // Shown in the sidebar by the newsroom plugin (src/cms/newsroom/sidebar.tsx).
    widget: "newsroom:articles",
    options: {
      slot: "response_to",
      scope: "posts",
      title: "Response to",
      helpText:
        "Slugs of the posts this responds to, such as news/red-teams. Separate several with commas.",
    },
  },
  {
    slug: "follow_up_to",
    label: "Follow-up to",
    type: "string",
    widget: "newsroom:articles",
    options: {
      slot: "follow_up_to",
      scope: "all",
      title: "Follow-up to",
      helpText:
        "Slugs of the posts this follows up on. Separate several with commas.",
    },
  },
];
const bodyFormat = {
  slug: "body_format",
  label: "Body format",
  type: "select",
  widget: "newsroom:body-format",
  // New articles are written in the rich-text editor. Articles migrated from
  // the MDX files say "mdx" themselves.
  defaultValue: "rich",
  validation: { options: ["mdx", "slack", "rich"] },
  options: {
    helpText:
      "Which body the article is made from. New articles are rich text. MDX is for articles moved from the files, and for editors who need code; submitters only get rich text. slack is for articles brought over from Slack, which keep Slack's formatting.",
  },
};
const body = {
  slug: "body",
  // Only one body is shown at a time, picked by the body format, so both are
  // simply called Body.
  label: "Body",
  type: "text",
  searchable: true,
  options: {
    rows: 30,
    helpText:
      "MDX: markdown, plus the components Caption, Emoji, M, RawHtml, SlackChannel, SlackMention and YouTube. No imports needed.",
  },
};
// The rich-text editor. Used when Body format is "rich"; its content becomes
// MDX when the page is drawn (src/cms/rich/to-mdx.ts).
const bodyRich = {
  slug: "body_rich",
  label: "Body",
  type: "portableText",
  searchable: true,
  options: {
    helpText:
      "Type / for a video, formula or other block, @ for a Slack person, # for a channel, :name: for an emoji and $$x^2$$ for a formula in a sentence.",
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
  taxonomies: [
    {
      name: "category",
      label: "Categories",
      labelSingular: "Category",
      hierarchical: false,
      collections: ["posts"],
      terms: POST_CATEGORIES.map((slug) => ({
        slug,
        label: slug[0].toUpperCase() + slug.slice(1),
      })),
    },
  ],
  collections: [
    {
      slug: "posts",
      label: "Posts",
      labelSingular: "Post",
      sortOrder: 1,
      // The admin list shows the article's date, not when it was last saved.
      dateField: "date",
      supports,
      fields: [
        title,
        date,
        author,
        excerpt,
        ...references,
        {
          slug: "members_only",
          label: "Members only",
          type: "boolean",
          widget: "newsroom:members-only",
          defaultValue: false,
          options: {
            helpText:
              "Readers must sign in with Hack Club to read this. It is left out of the front page, archives, search and RSS for everyone else.",
          },
        },
        // The `id` the MDX files gave some posts. Kept, never edited.
        {
          slug: "legacy_id",
          label: "Legacy ID",
          type: "string",
          widget: "newsroom:hidden",
          options: { field: "legacy_id" },
        },
        bodyFormat,
        body,
        bodyRich,
      ],
    },
    {
      slug: "changelogs",
      label: "Changelogs",
      labelSingular: "Changelog",
      urlPattern: "/changelogs/{slug}",
      sortOrder: 2,
      dateField: "date",
      supports,
      fields: [
        {
          ...title,
          options: {
            helpText:
              "With no body, this is a one-line entry on the changelog page, and the title is the change.",
          },
        },
        date,
        author,
        excerpt,
        ...references,
        bodyFormat,
        body,
        bodyRich,
      ],
    },
    {
      slug: "pages",
      label: "Pages",
      labelSingular: "Page",
      urlPattern: "/{slug}",
      sortOrder: 3,
      supports,
      fields: [{ ...title, required: false }, bodyFormat, body, bodyRich],
    },
  ],
  content: { posts, changelogs, pages },
};

const dir = join(OUT_FILE, "..");
const write = (file: string, data: unknown) =>
  writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
await mkdir(dir, { recursive: true });
await write(OUT_FILE, seed);
const { settings: _settings, content: _content, ...model } = seed;
await write(join(dir, "model.json"), model);
await write(join(dir, "short-changelogs.json"), {
  ...model,
  meta: { ...model.meta, description: "One-line changelog entries." },
  content: { changelogs: shortChangelogs },
});
console.log(
  `${OUT_FILE}: ${posts.length} posts, ${changelogs.length} changelogs, ${pages.length} pages; ${shortChangelogs.length} one-line changelogs`,
);
