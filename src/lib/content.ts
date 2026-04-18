import { getCollection, getEntry, type CollectionEntry } from "astro:content";
import siteData from "../data/site.json";
import frontpageData from "../data/frontpage.json";
import changelogData from "../data/changelog.json";
import acknowledgementsData from "../data/acknowledgements.json";

export type SiteConfig = {
    title: string;
    description: string;
};

export type Post = {
    slug: string;
    url: string;
    title: string;
    author?: string;
    category?: string;
    date: Date;
    excerpt: string;
    paragraphs: string[];
    leadingImage?: {
        src: string;
        alt: string;
    };
    entry: CollectionEntry<"posts">;
};

export type ChangelogEntry = {
    change: string;
    date: string;
    author: string;
    slackId?: string;
};

export type Acknowledgement = {
    name: string;
    slackId?: string;
};

type FrontpageData = {
    headline?: string[];
    opinion?: string[];
};

function normalizeWhitespace(input: string): string {
    return input.replace(/\s+/g, " ").trim();
}

function truncateWords(input: string, count: number): string {
    const words = normalizeWhitespace(input).split(" ");
    if (words.length <= count) {
        return words.join(" ");
    }

    return `${words.slice(0, count).join(" ")}...`;
}

function replaceSlackMentionComponents(input: string): string {
    return input.replace(/<SlackMention\s+name="([^"]+)"\s+id="([^"]+)"\s*\/?>/g, (_match, name) => `@${name}`);
}

function replaceSlackChannelComponents(input: string): string {
    return input.replace(/<SlackChannel\s+id="([^"]+)"\s*\/?>/g, (_match, id) => `#${id}`);
}

function stripMarkdown(input: string): string {
    return normalizeWhitespace(
        replaceSlackChannelComponents(replaceSlackMentionComponents(input))
            .replace(/^import\s.+$/gm, "")
            .replace(/^export\s.+$/gm, "")
            .replace(/^#{1,6}\s+/gm, "")
            .replace(/^\s*[-*+]\s+/gm, "")
            .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
            .replace(/`([^`]+)`/g, "$1")
            .replace(/\*\*([^*]+)\*\*/g, "$1")
            .replace(/\*([^*]+)\*/g, "$1")
            .replace(/_{1,2}([^_]+)_{1,2}/g, "$1")
            .replace(/<[^>]+>/g, " ")
    );
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

function extractImageFromBlock(block: string): { src: string; alt: string } | undefined {
    const markdownImage = block.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/s);
    if (markdownImage) {
        return {
            alt: markdownImage[1],
            src: markdownImage[2]
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
        alt: getAttributeValue(tag, "alt") ?? ""
    };
}

function extractTextBlocks(body: string): string[] {
    const blocks = getBodyBlocks(body);
    const leadingImage = extractImageFromBlock(blocks[0] ?? "");

    return blocks
        .slice(leadingImage ? 1 : 0)
        .map((block) => stripMarkdown(block))
        .filter(Boolean);
}

function toExcerpt(entry: { body: string; data: { excerpt?: string } }): string {
    const explicitExcerpt = entry.data.excerpt;
    const source = explicitExcerpt ?? extractTextBlocks(entry.body)[0] ?? "";

    return stripMarkdown(source);
}

export async function getSiteConfig(): Promise<SiteConfig> {
    return {
        title: siteData.title,
        description: siteData.description
    };
}

export async function getPosts(): Promise<Post[]> {
    const posts = await getCollection("posts");

    return posts
        .sort((a, b) => b.data.date.getTime() - a.data.date.getTime())
        .map((entry) => {
            const bodyBlocks = getBodyBlocks(entry.body);
            const leadingImage = extractImageFromBlock(bodyBlocks[0] ?? "");
            const paragraphs = extractTextBlocks(entry.body);
            const [category] = entry.slug.split("/", 1);

            return {
                slug: entry.slug,
                url: `/${entry.slug}/`,
                title: entry.data.title,
                author: entry.data.author,
                category,
                date: entry.data.date,
                excerpt: toExcerpt(entry),
                paragraphs,
                leadingImage,
                entry
            } satisfies Post;
        });
}

export async function getFrontpageData(): Promise<FrontpageData> {
    return frontpageData;
}

export async function getChangelogEntries(): Promise<ChangelogEntry[]> {
    return changelogData;
}

export async function getAcknowledgements(): Promise<Acknowledgement[]> {
    return acknowledgementsData;
}

export async function getRecentChangelogEntries(days: number): Promise<ChangelogEntry[]> {
    const nowTimestamp = Date.now();
    const threshold = nowTimestamp - days * 24 * 60 * 60 * 1000;

    return (await getChangelogEntries()).filter((entry) => new Date(`${entry.date}T00:00:00Z`).getTime() >= threshold);
}

export function formatStoryDate(date: Date): string {
    return new Intl.DateTimeFormat("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric"
    }).format(date);
}

export async function getPageEntry(slug: string): Promise<CollectionEntry<"pages">> {
    const entry = await getEntry("pages", slug);
    if (!entry) {
        throw new Error(`Missing required content entry pages/${slug}`);
    }

    return entry;
}

export { truncateWords };
