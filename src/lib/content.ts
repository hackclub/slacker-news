import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import yaml from "js-yaml";
import MarkdownIt from "markdown-it";

const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, "src", "site");
const POSTS_DIR = path.join(CONTENT_DIR, "posts");
const DATA_DIR = path.join(CONTENT_DIR, "data");
const PAGES_DIR = path.join(CONTENT_DIR, "pages");

const markdown = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false
});

type MaybeString = string | undefined;

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
    html: string;
    excerpt: string;
    paragraphs: string[];
};

export type ChangelogEntry = {
    change: string;
    date: string;
    author: string;
};

type FrontpageData = {
    headline?: string[];
    opinion?: string[];
};

const CHANNEL_REGEX = /##([\w-]+)|\B#([\w-]+)/g;

function readText(filePath: string): string {
    return fs.readFileSync(filePath, "utf8");
}

function normalizeWhitespace(input: string): string {
    return input.replace(/\s+/g, " ").trim();
}

function stripHtml(input: string): string {
    return normalizeWhitespace(input.replace(/<[^>]*>/g, " "));
}

function truncateWords(input: string, count: number): string {
    const words = normalizeWhitespace(input).split(" ");
    if (words.length <= count) {
        return words.join(" ");
    }

    return `${words.slice(0, count).join(" ")}...`;
}

function replaceSlackUserTags(markdownSource: string): string {
    return markdownSource.replace(/\{%\s*slack_user\s+([^%]+?)\s*%\}/g, (_match, markup) => {
        const rawMarkup = String(markup).trim();
        const lastComma = rawMarkup.lastIndexOf(",");
        if (lastComma === -1) {
            return _match;
        }

        const cleanName = rawMarkup.slice(0, lastComma).trim();
        const cleanId = rawMarkup.slice(lastComma + 1).trim();
        if (!cleanName || !cleanId) {
            return _match;
        }

        return `<a href="https://hackclub.slack.com/team/${cleanId}" class="slack_user" target="_blank">@${cleanName}</a>`;
    });
}

function linkSlackChannels(html: string): string {
    return html.replace(/>([^<]+)</g, (_match, textContent) => {
        const linkedText = String(textContent).replace(CHANNEL_REGEX, (_inner, escaped, channel) => {
            if (escaped) {
                return `#${escaped}`;
            }

            return `<a href="https://hackclub.slack.com/archives/${channel}" class="slack_channel" target="_blank">#${channel}</a>`;
        });

        return `>${linkedText}<`;
    });
}

function renderMarkdown(input: string): string {
    const withSlackUsers = replaceSlackUserTags(input);
    const rendered = markdown.render(withSlackUsers);

    return linkSlackChannels(rendered);
}

function inferDateFromFilename(filename: string): Date {
    const datePart = filename.slice(0, 10);

    return new Date(`${datePart}T00:00:00Z`);
}

function inferSlugFromFilename(filename: string): string {
    return filename.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/\.md$/, "");
}

function extractParagraphs(html: string): string[] {
    const matches = html.match(/<p>[\s\S]*?<\/p>/g) ?? [];
    return matches.map((paragraph) => stripHtml(paragraph)).filter(Boolean);
}

function parseYamlFile<T>(filePath: string): T {
    return yaml.load(readText(filePath)) as T;
}

export function getSiteConfig(): SiteConfig {
    const raw = parseYamlFile<Record<string, MaybeString>>(path.join(CONTENT_DIR, "site.yml"));

    return {
        title: raw.title ?? "Slacker News",
        description: raw.description ?? "Official news from Hack Club Slack."
    };
}

export function getPosts(): Post[] {
    const filenames: string[] = fs.readdirSync(POSTS_DIR).filter((name: string) => name.endsWith(".md"));

    const posts: Post[] = filenames.map((filename: string) => {
        const filePath = path.join(POSTS_DIR, filename);
        const raw = readText(filePath);
        const parsed = matter(raw);
        const html = renderMarkdown(parsed.content);
        const paragraphs = extractParagraphs(html);

        const date = parsed.data.date ? new Date(String(parsed.data.date)) : inferDateFromFilename(filename);
        const slug = String(parsed.data.slug ?? inferSlugFromFilename(filename));
        const explicitExcerpt = parsed.data.excerpt ? String(parsed.data.excerpt) : undefined;
        const excerptSource = explicitExcerpt ?? paragraphs[0] ?? "";

        return {
            slug,
            url: `/${slug}/`,
            title: String(parsed.data.title ?? slug),
            author: parsed.data.author ? String(parsed.data.author) : undefined,
            category: parsed.data.category ? String(parsed.data.category) : undefined,
            date,
            html,
            excerpt: stripHtml(excerptSource),
            paragraphs
        } satisfies Post;
    });

    return posts.sort((a: Post, b: Post) => b.date.getTime() - a.date.getTime());
}

export function getFrontpageData(): FrontpageData {
    return parseYamlFile<FrontpageData>(path.join(DATA_DIR, "frontpage.yml"));
}

export function getChangelogEntries(): ChangelogEntry[] {
    return parseYamlFile<ChangelogEntry[]>(path.join(DATA_DIR, "changelog.yml"));
}

export function getRecentChangelogEntries(days: number): ChangelogEntry[] {
    const nowTimestamp = Date.now();
    const threshold = nowTimestamp - days * 24 * 60 * 60 * 1000;

    return getChangelogEntries().filter((entry) => new Date(`${entry.date}T00:00:00Z`).getTime() >= threshold);
}

export function formatStoryDate(date: Date): string {
    return new Intl.DateTimeFormat("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric"
    }).format(date);
}

export function getPageMarkdown(filePath: string): { title?: string; html: string } {
    const parsed = matter(readText(path.join(PAGES_DIR, filePath)));

    return {
        title: parsed.data.title ? String(parsed.data.title) : undefined,
        html: renderMarkdown(parsed.content)
    };
}

export function getPageHtml(filePath: string): { title?: string; html: string } {
    const parsed = matter(readText(path.join(PAGES_DIR, filePath)));

    return {
        title: parsed.data.title ? String(parsed.data.title) : undefined,
        html: parsed.content
    };
}

export { truncateWords };
