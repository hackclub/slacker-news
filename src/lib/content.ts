import {
  cmsEnabled,
  loadChangelogs,
  loadPage,
  loadPeople,
  loadPosts,
  loadSiteSettings,
} from "#content-source";
import type {
  ChangelogData,
  PageData,
  PostData,
  SourceEntry,
} from "./content-source/types";
import siteData from "../data/site.json";
import changelogData from "../data/changelog.json";
import acknowledgementsData from "../data/acknowledgements.json";

export type SiteConfig = {
  title: string;
  description: string;
  headlineOverride: string | null;
};

export type PostReference = {
  slug: string;
  url: string;
  title: string;
};

export type Post = {
  id: string;
  slug: string;
  url: string;
  title: string;
  author?: string | string[];
  authorSlackIds?: string[];
  category?: string;
  date: Date;
  excerpt: string;
  frontPagePreview?: string[];
  paragraphs: string[];
  readingTime: number;
  leadingImage?: {
    src: string;
    alt: string;
  };
  /** Only signed-in readers may see this post. */
  membersOnly: boolean;
  entry: SourceEntry<PostData>;
  responseTo?: string[];
  followUpTo?: string[];
  responses?: PostReference[];
  followUps?: PostReference[];
};

type ChangelogBase = {
  date: string;
  author: string | string[];
  slackIds?: string[];
};

export type ShortChangelogEntry = ChangelogBase & {
  kind: "short";
  change: string;
};

export type LongChangelogEntry = ChangelogBase & {
  kind: "long";
  slug: string;
  url: string;
  title: string;
  excerpt: string;
  paragraphs: string[];
  readingTime: number;
  leadingImage?: {
    src: string;
    alt: string;
  };
  entry: SourceEntry<ChangelogData>;
  responseTo?: PostReference[];
  followUpTo?: PostReference[];
};

export type ChangelogEntry = ShortChangelogEntry | LongChangelogEntry;

export type AcknowledgementRole = "editor" | "technical" | "content";

export type Acknowledgement = {
  name: string;
  slackId?: string;
  roles?: AcknowledgementRole[];
};

export type AcknowledgementGroups = {
  editors: Acknowledgement[];
  technical: Acknowledgement[];
  content: Acknowledgement[];
  other: Acknowledgement[];
};

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function truncateWords(input: string, count: number): string {
  const words = normalizeWhitespace(input).split(" ");
  const wordWeight = (word: string) => word.split(/-+/).filter(Boolean).length;
  const totalWeight = words.reduce((sum, word) => sum + wordWeight(word), 0);

  if (totalWeight <= count) {
    return words.join(" ");
  }

  const included: string[] = [];
  let usedWeight = 0;

  for (const word of words) {
    const weight = wordWeight(word);
    if (included.length > 0 && usedWeight + weight > count) break;
    included.push(word);
    usedWeight += weight;
    if (usedWeight >= count) break;
  }

  return `${included.join(" ")}...`;
}

// Bylines sometimes carry a parenthetical alias, e.g. "@neven (hex4)". Drop it
// so the handle still matches the acknowledgements file and one person is not
// credited twice under two spellings.
function normalizeHandle(handle: string): string {
  return handle
    .trim()
    .replace(/^@+/, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim()
    .toLowerCase();
}

// A byline can name several people in one string, e.g. "@eps and @zrl". Split
// on separators only, never on spaces: handles like "@Raygen Rupe" have them.
function splitAuthors(author: string): string[] {
  return author
    .split(/\s+and\s+|\s*[,&]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function getAuthorSlackId(author: string | undefined): string | undefined {
  if (!author) {
    return undefined;
  }

  // Articles brought over from Slack name their author by Slack ID.
  const slackId = author
    .trim()
    .match(/^<?@?([UW][A-Z0-9]{6,})(?:\|[^>]*)?>?$/)?.[1];
  if (slackId) return slackId;

  const normalizedAuthor = normalizeHandle(author);
  const matchingAcknowledgement = acknowledgementsData.find(
    (person) => normalizeHandle(person.name) === normalizedAuthor,
  );

  return matchingAcknowledgement?.slackId;
}

function getAuthorSlackIds(authors: string | string[] | undefined): string[] {
  if (!authors) {
    return [];
  }

  const authorArray = Array.isArray(authors) ? authors : [authors];

  return authorArray
    .map((author) => getAuthorSlackId(author))
    .filter((id): id is string => Boolean(id));
}

/** An attribute of a component tag, written `name="x"` or `name={"x"}`. */
function tagAttribute(tag: string, name: string): string | undefined {
  const match = new RegExp(
    `\\b${name}=(?:"([^"]*)"|\\{"((?:[^"\\\\]|\\\\.)*)"\\})`,
  ).exec(tag);
  if (!match) return undefined;
  return match[1] ?? match[2].replace(/\\(.)/g, "$1");
}

function replaceSlackMentionComponents(input: string): string {
  return input.replace(/<SlackMention\b[^>]*\/?>/g, (tag) => {
    const name = tagAttribute(tag, "name");
    return name ? `@${name}` : "";
  });
}

function replaceSlackChannelComponents(input: string): string {
  return input.replace(/<SlackChannel\b[^>]*\/?>/g, (tag) => {
    const name = tagAttribute(tag, "label") ?? tagAttribute(tag, "id");
    return name ? `#${name}` : "";
  });
}

function stripMarkdown(input: string): string {
  const isBlockquote = /^\s*>/m.test(input);
  const cleaned = isBlockquote ? input.replace(/^\s*>\s?/gm, "") : input;
  const stripped = normalizeWhitespace(
    replaceSlackChannelComponents(replaceSlackMentionComponents(cleaned))
      .replace(/^import\s.+$/gm, "")
      .replace(/^export\s.+$/gm, "")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/_{1,2}([^_]+)_{1,2}/g, "$1")
      .replace(/<[^>]+>/g, " "),
  );
  return isBlockquote ? `\u201C${stripped}` : stripped;
}

function getBodyBlocks(body: string): string[] {
  return body
    .replace(/^import\s.+$/gm, "")
    .replace(/^export\s.+$/gm, "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function getAttributeValue(tag: string, attribute: string): string | undefined {
  return tag.match(new RegExp(`${attribute}=["']([^"']*)["']`, "i"))?.[1];
}

function extractImageFromBlock(
  block: string,
): { src: string; alt: string } | undefined {
  const markdownImage = block.match(
    /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/s,
  );
  if (markdownImage) {
    return {
      alt: markdownImage[1],
      src: markdownImage[2],
    };
  }

  const imgTag = block.match(/<img\b[^>]*>/i);
  if (!imgTag) {
    return undefined;
  }

  const tag = imgTag[0];
  const src = getAttributeValue(tag, "src");
  if (!src) {
    return undefined;
  }

  return {
    src,
    alt: getAttributeValue(tag, "alt") ?? "",
  };
}

function isTableBlock(block: string): boolean {
  return block
    .split("\n")
    .some(
      (line) =>
        /^\s*\|?[\s\-:|]+\|[\s\-:|]+\|?\s*$/.test(line) && /-/.test(line),
    );
}

function isListBlock(block: string): boolean {
  const listLines = block
    .split("\n")
    .filter((line) => /^\s*([-*+]|\d+\.)\s+/.test(line));
  return listLines.length >= 2;
}

function extractTextBlocks(body: string): string[] {
  const blocks = getBodyBlocks(body);
  const leadingImage = extractImageFromBlock(blocks[0] ?? "");

  return blocks
    .slice(leadingImage ? 1 : 0)
    .filter((block) => {
      if (/^#{1,6}\s+/.test(block.trim())) return false;
      if (/^[=-]{3,}\s*$/.test(block.trim())) return false;
      if (isTableBlock(block)) return false;
      if (isListBlock(block)) return false;
      if (/^<Caption[\s>]/i.test(block.trim())) return false;
      return true;
    })
    .map((block) => stripMarkdown(block))
    .filter(Boolean);
}

/** The paragraphs of an article's summary, blank-line separated. */
function summaryParagraphs(summary: string | undefined): string[] {
  return (summary ?? "")
    .split(/\n{2,}/)
    .map((paragraph) => stripMarkdown(paragraph))
    .filter(Boolean);
}

function toExcerpt(entry: {
  body: string;
  data: { excerpt?: string };
}): string {
  // The summary's first paragraph is the short description; the rest is for
  // the front page (see summaryParagraphs).
  const explicitExcerpt = summaryParagraphs(entry.data.excerpt)[0];
  if (explicitExcerpt) {
    return explicitExcerpt;
  }

  const blocks = extractTextBlocks(entry.body);
  const substantial = blocks.find((b) => {
    const cleaned = stripMarkdown(b);
    const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
    return wordCount >= 8 && cleaned.length >= 60;
  });

  const source = substantial ?? blocks[0] ?? "";
  return stripMarkdown(source);
}

export async function getSiteConfig(): Promise<SiteConfig> {
  // In the CMS these are settings; the file serves the rest, and fills in
  // anything an editor left empty.
  const cms = await loadSiteSettings();
  return {
    title: cms?.title ?? siteData.title,
    description: cms?.description ?? siteData.description,
    headlineOverride: cms
      ? (cms.headlineOverride ?? null)
      : (siteData.headlineOverride ?? null),
  };
}

/**
 * Members-only posts are left out unless `includeProtected` is set, so a
 * caller that does not think about them cannot leak one. Pass it only for a
 * reader who is signed in.
 */
export async function getPosts({
  includeProtected = false,
}: { includeProtected?: boolean } = {}): Promise<Post[]> {
  const posts = (await loadPosts()).filter(
    (entry) => includeProtected || !entry.data.membersOnly,
  );

  const processedPosts: Post[] = posts
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime())
    .map((entry) => {
      const bodyBlocks = getBodyBlocks(entry.body!);
      const leadingImage = extractImageFromBlock(bodyBlocks[0] ?? "");
      const paragraphs = extractTextBlocks(entry.body!);
      const [category] = entry.id.split("/", 1);

      const responseTo = entry.data.responseTo
        ? Array.isArray(entry.data.responseTo)
          ? entry.data.responseTo
          : [entry.data.responseTo]
        : undefined;

      const followUpTo = entry.data.followUpTo
        ? Array.isArray(entry.data.followUpTo)
          ? entry.data.followUpTo
          : [entry.data.followUpTo]
        : undefined;

      const wordCount = paragraphs.reduce(
        (sum, p) => sum + p.split(/\s+/).filter(Boolean).length,
        0,
      );

      return {
        id: entry.data.id ?? entry.id,
        slug: entry.id,
        url: `/${entry.id}/`,
        title: entry.data.title,
        author: entry.data.author,
        authorSlackIds:
          entry.data.authorSlackIds ?? getAuthorSlackIds(entry.data.author),
        category,
        date: entry.data.date,
        excerpt: toExcerpt({ body: entry.body!, data: entry.data }),
        // A summary of several paragraphs is what the front page shows when
        // this is the headline; a one-paragraph summary is only a description.
        frontPagePreview:
          summaryParagraphs(entry.data.excerpt).length > 1
            ? summaryParagraphs(entry.data.excerpt)
            : undefined,
        paragraphs,
        readingTime: Math.max(1, Math.ceil(wordCount / 200)),
        leadingImage,
        membersOnly: Boolean(entry.data.membersOnly),
        entry,
        responseTo,
        followUpTo,
      } satisfies Post;
    });

  for (const post of processedPosts) {
    for (const otherPost of processedPosts) {
      if (otherPost.responseTo?.some((ref) => sameArticle(ref, post.slug))) {
        if (!post.responses) post.responses = [];
        const exists = post.responses.some((r) => r.slug === otherPost.slug);
        if (!exists) {
          post.responses.push({
            slug: otherPost.slug,
            url: otherPost.url,
            title: otherPost.title,
          });
        }
      }
      if (otherPost.followUpTo?.some((ref) => sameArticle(ref, post.slug))) {
        if (!post.followUps) post.followUps = [];
        const exists = post.followUps.some((f) => f.slug === otherPost.slug);
        if (!exists) {
          post.followUps.push({
            slug: otherPost.slug,
            url: otherPost.url,
            title: otherPost.title,
          });
        }
      }
    }
  }

  return processedPosts;
}

/**
 * Whether a reference ("response to", "follow-up to") names an article. The
 * CMS picker stores the slug alone, which survives a change of category; the
 * MDX files write `category/slug`. Either matches.
 */
function sameArticle(reference: string, slug: string): boolean {
  const last = (text: string) => text.trim().split("/").pop();
  return last(reference) === last(slug);
}

export async function getChangelogEntries(): Promise<ChangelogEntry[]> {
  const changelogs = await loadChangelogs();
  // In the CMS a one-line entry is a changelog with no body: its title is the
  // change. Without the CMS they come from src/data/changelog.json.
  const isShort = (entry: SourceEntry<ChangelogData>) =>
    cmsEnabled && !entry.body.trim();
  const shortEntries: ShortChangelogEntry[] = cmsEnabled
    ? changelogs.filter(isShort).map((entry) => ({
        kind: "short",
        change: entry.data.title,
        date: entry.data.date.toISOString().slice(0, 10),
        author: entry.data.author,
        slackIds:
          entry.data.authorSlackIds ?? getAuthorSlackIds(entry.data.author),
      }))
    : changelogData.map((entry) => ({
        kind: "short",
        change: entry.change,
        date: entry.date,
        author: entry.author,
        slackIds: getAuthorSlackIds(entry.author),
      }));

  const longCollection = changelogs.filter((entry) => !isShort(entry));
  const posts = await getPosts();
  const resolveSlugs = (
    raw: string | string[] | undefined,
  ): PostReference[] | undefined => {
    if (!raw) return undefined;
    const slugs = Array.isArray(raw) ? raw : [raw];
    const refs = slugs
      .map((slug) => posts.find((p) => sameArticle(p.slug, slug)))
      .filter((p): p is Post => Boolean(p))
      .map((p) => ({ slug: p.slug, url: p.url, title: p.title }));
    return refs.length ? refs : undefined;
  };
  const longEntries: LongChangelogEntry[] = longCollection.map((entry) => {
    const bodyBlocks = getBodyBlocks(entry.body!);
    const leadingImage = extractImageFromBlock(bodyBlocks[0] ?? "");
    const paragraphs = extractTextBlocks(entry.body!);
    const dateString = entry.data.date.toISOString().slice(0, 10);
    const wordCount = paragraphs.reduce(
      (sum, p) => sum + p.split(/\s+/).filter(Boolean).length,
      0,
    );
    return {
      kind: "long",
      slug: entry.id,
      url: `/changelogs/${entry.id}/`,
      title: entry.data.title,
      date: dateString,
      author: entry.data.author,
      slackIds:
        entry.data.authorSlackIds ?? getAuthorSlackIds(entry.data.author),
      excerpt: toExcerpt({ body: entry.body!, data: entry.data }),
      paragraphs,
      readingTime: Math.max(1, Math.ceil(wordCount / 200)),
      leadingImage,
      entry,
      responseTo: resolveSlugs(entry.data.responseTo),
      followUpTo: resolveSlugs(entry.data.followUpTo),
    };
  });

  return [...shortEntries, ...longEntries].sort(
    (a, b) =>
      new Date(`${b.date}T00:00:00Z`).getTime() -
      new Date(`${a.date}T00:00:00Z`).getTime(),
  );
}

export async function getAcknowledgements(): Promise<Acknowledgement[]> {
  // In the CMS the people are bylines; the file serves the rest.
  return ((await loadPeople()) ?? acknowledgementsData) as Acknowledgement[];
}

function hasRole(person: Acknowledgement, role: AcknowledgementRole): boolean {
  return (person.roles ?? []).includes(role);
}

function byName(a: Acknowledgement, b: Acknowledgement): number {
  return normalizeHandle(a.name).localeCompare(normalizeHandle(b.name));
}

// Editors keep their order from the acknowledgements file; every other section
// is sorted by handle. Sections may overlap: someone who writes and ships code
// belongs in both lists. Content contributors are everyone with the content
// role plus every article author.
export async function getAcknowledgementGroups(): Promise<AcknowledgementGroups> {
  const people = await getAcknowledgements();
  const editors = people.filter((person) => hasRole(person, "editor"));
  const editorHandles = new Set(
    editors.map((person) => normalizeHandle(person.name)),
  );

  const posts = await getPosts();
  const submitterHandles = new Map<string, Acknowledgement>();

  for (const post of posts) {
    const bylines = Array.isArray(post.author)
      ? post.author
      : post.author
        ? [post.author]
        : [];

    for (const byline of bylines) {
      for (const author of splitAuthors(byline)) {
        const handle = normalizeHandle(author);
        if (
          !handle ||
          editorHandles.has(handle) ||
          submitterHandles.has(handle)
        ) {
          continue;
        }

        // Authors missing from the acknowledgements file are still credited,
        // just without a Slack mention to link them to.
        const known = people.find(
          (person) => normalizeHandle(person.name) === handle,
        );
        submitterHandles.set(handle, known ?? { name: author });
      }
    }
  }

  // A declared role always places someone, editors included: an editor who also
  // writes the code should be credited for both. Only the byline-derived list
  // excludes them, or the editors would dominate it by sheer byline count.
  const byDeclaredRole = (role: AcknowledgementRole) =>
    people.filter((person) => hasRole(person, role));

  const technical = byDeclaredRole("technical").sort(byName);

  const contentHandles = new Map(submitterHandles);
  for (const person of byDeclaredRole("content")) {
    contentHandles.set(normalizeHandle(person.name), person);
  }
  const content = [...contentHandles.values()].sort(byName);

  const credited = new Set([
    ...editorHandles,
    ...technical.map((person) => normalizeHandle(person.name)),
    ...contentHandles.keys(),
  ]);

  const other = people
    .filter((person) => !credited.has(normalizeHandle(person.name)))
    .sort(byName);

  return { editors, technical, content, other };
}

export async function getRecentChangelogEntries(
  days: number,
): Promise<ChangelogEntry[]> {
  const nowTimestamp = Date.now();
  const threshold = nowTimestamp - days * 24 * 60 * 60 * 1000;

  return (await getChangelogEntries()).filter(
    (entry) => new Date(`${entry.date}T00:00:00Z`).getTime() >= threshold,
  );
}

export function formatStoryDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export async function getPageEntry(
  slug: string,
): Promise<SourceEntry<PageData>> {
  const entry = await loadPage(slug);
  if (!entry) {
    throw new Error(`Missing required content entry pages/${slug}`);
  }

  return entry;
}

export { truncateWords };
