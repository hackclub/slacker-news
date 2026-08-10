#!/usr/bin/env bun

import { readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import { generateAbacusKey, getAbacusGetUrl } from "../src/lib/abacus";

const ABACUS_LIMIT = 30;
const ABACUS_WINDOW_MS = 10_000;
// Leave a little headroom below Abacus' documented 30 requests / 10 seconds.
const SAFE_REQUEST_LIMIT = 20;
const MIN_REQUEST_INTERVAL_MS = 500;
const DEFAULT_NAMESPACE = "news.hackclub.com";
const DEFAULT_HOSTNAME = "news.hackclub.com";

type Options = {
    date: string;
    namespace: string;
    hostname: string;
    output: string;
    dedupe: boolean;
    plausibleApiKey?: string;
    plausibleStartDate: string;
};

type Page = { path: string; key: string };

function usage(exitCode = 1): never {
    console.error(`Usage: bun run export:abacus [options]

Options:
  --date YYYY-MM-DD       Snapshot date (default: today in UTC)
  --namespace NAME        Abacus namespace (default: ${DEFAULT_NAMESPACE})
  --hostname NAME         Plausible hostname (default: ${DEFAULT_HOSTNAME})
  --output PATH           Output CSV path (default: imported_pages_DATE_DATE.csv)
  --dedupe                Subtract native Plausible pageviews from Abacus values
  --plausible-api-key KEY Stats API key (or PLAUSIBLE_STATS_API_KEY)
  --plausible-start DATE  First date included in Plausible query (default: 1970-01-01)
  --help                  Show this help
`);
    process.exit(exitCode);
}

function today(): string {
    return new Date().toISOString().slice(0, 10);
}

function parseArgs(args: string[]): Options {
    const values = new Map<string, string>();
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === "--help") usage(0);
        if (!arg.startsWith("--")) usage();

        const [name, inlineValue] = arg.split("=", 2);
        if (name === "--dedupe" && inlineValue === undefined) {
            values.set(name, "true");
            continue;
        }
        const value = inlineValue ?? args[++index];
        if (!value || value.startsWith("--")) usage();
        values.set(name, value);
    }

    const date = values.get("--date") ?? today();
    const parsedDate = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
        throw new Error(`Invalid date: ${date}. Use YYYY-MM-DD.`);
    }

    const filenameDate = date.replaceAll("-", "");
    const dedupe = values.has("--dedupe");
    const plausibleApiKey = values.get("--plausible-api-key") ?? process.env.PLAUSIBLE_STATS_API_KEY;
    if (dedupe && !plausibleApiKey) {
        throw new Error("--dedupe requires --plausible-api-key or PLAUSIBLE_STATS_API_KEY.");
    }

    const plausibleStartDate = values.get("--plausible-start") ?? "1970-01-01";
    const parsedStartDate = new Date(`${plausibleStartDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(plausibleStartDate) || Number.isNaN(parsedStartDate.getTime())) {
        throw new Error(`Invalid Plausible start date: ${plausibleStartDate}. Use YYYY-MM-DD.`);
    }

    return {
        date,
        namespace: values.get("--namespace") ?? DEFAULT_NAMESPACE,
        hostname: values.get("--hostname") ?? DEFAULT_HOSTNAME,
        output: values.get("--output") ?? `${dedupe ? "imported_pages_deduped" : "imported_pages"}_${filenameDate}_${filenameDate}.csv`,
        dedupe,
        plausibleApiKey,
        plausibleStartDate
    };
}

function walk(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? walk(path) : [path];
    });
}

function pagesToExport(): Page[] {
    const staticPaths = [
        "/",
        "/about/",
        "/submissions/",
        "/acknowledgements/",
        "/changelogs/",
        "/news/",
        "/opinion/",
        "/essays/",
        "/stats/"
    ];

    const postPaths = walk("src/content/posts")
        .filter((path) => ["news", "opinion", "essays"].includes(relative("src/content/posts", dirname(path)).split("/")[0]))
        .filter((path) => extname(path) === ".mdx")
        .map((path) => {
            const category = relative("src/content/posts", dirname(path));
            return `/${category}/${basename(path, extname(path))}/`;
        });

    const changelogPaths = walk("src/content/posts/changelogs")
        .filter((path) => extname(path) === ".mdx")
        .map((path) => `/changelogs/${basename(path, extname(path))}/`);

    const byKey = new Map<string, Page>();
    for (const path of [...staticPaths, ...postPaths, ...changelogPaths]) {
        const key = generateAbacusKey(path);
        if (!byKey.has(key)) byKey.set(key, { path, key });
    }

    return [...byKey.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class RateLimiter {
    private readonly requests: number[] = [];
    private lastRequest = 0;

    async beforeRequest(): Promise<void> {
        const intervalWait = this.lastRequest + MIN_REQUEST_INTERVAL_MS - Date.now();
        if (intervalWait > 0) await wait(intervalWait);

        const now = Date.now();
        while (this.requests.length && this.requests[0] <= now - ABACUS_WINDOW_MS) this.requests.shift();

        if (this.requests.length >= SAFE_REQUEST_LIMIT) {
            await wait(this.requests[0] + ABACUS_WINDOW_MS - now + 50);
            return this.beforeRequest();
        }
        this.lastRequest = Date.now();
        this.requests.push(this.lastRequest);
    }
}

function retryDelay(response: Response, attempt: number): number {
    const retryAfter = Number(response.headers.get("Retry-After"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(30_000, Math.max(10_000, retryAfter));

    const reset = Number(response.headers.get("RateLimit-Reset"));
    if (Number.isFinite(reset) && reset > 0) return Math.min(30_000, Math.max(10_000, reset * 1000 - Date.now()));
    return Math.min(30_000, Math.max(10_000, 1_000 * 2 ** (attempt - 1)));
}

async function getCounter(page: Page, namespace: string, limiter: RateLimiter): Promise<number> {
    for (let attempt = 1; attempt <= 12; attempt += 1) {
        await limiter.beforeRequest();
        const response = await fetch(getAbacusGetUrl(page.key, namespace));

        if (response.ok) {
            const value = Number((await response.json() as { value?: unknown }).value);
            if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid value for ${page.path}`);
            return value;
        }

        if (response.status === 404) return 0;
        if (response.status !== 429 || attempt === 12) {
            throw new Error(`Abacus returned HTTP ${response.status} for ${page.path}`);
        }
        await wait(retryDelay(response, attempt));
    }
    throw new Error(`Could not retrieve ${page.path}`);
}

function csvCell(value: string | number): string {
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

type PlausibleQueryResponse = {
    results?: Array<{ dimensions?: unknown[]; metrics?: unknown[] }>;
};

async function getPlausiblePageviews(options: Options): Promise<Map<string, number>> {
    if (!options.dedupe || !options.plausibleApiKey) return new Map();

    const response = await fetch("https://plausible.io/api/v2/query", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${options.plausibleApiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            site_id: options.hostname,
            date_range: [options.plausibleStartDate, options.date],
            metrics: ["pageviews"],
            dimensions: ["event:page"],
            pagination: { limit: 10_000, offset: 0 }
        })
    });

    if (!response.ok) {
        throw new Error(`Plausible Stats API returned HTTP ${response.status}`);
    }

    const data = await response.json() as PlausibleQueryResponse;
    const pageviews = new Map<string, number>();
    for (const result of data.results ?? []) {
        const page = result.dimensions?.[0];
        const value = result.metrics?.[0];
        if (typeof page !== "string" || typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
            throw new Error("Plausible returned an invalid pageview result.");
        }
        pageviews.set(page, value);
    }
    return pageviews;
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const pages = pagesToExport();
    const limiter = new RateLimiter();
    const plausiblePageviews = await getPlausiblePageviews(options);
    const rows = ["date,hostname,page,pageviews"];

    console.error(`Exporting ${pages.length} Abacus counters${options.dedupe ? " with Plausible deduplication" : ""} (rate limit: ${ABACUS_LIMIT} requests / 10 seconds)...`);
    for (const [index, page] of pages.entries()) {
        const abacusPageviews = await getCounter(page, options.namespace, limiter);
        // Plausible normally returns the pathname as-is, but encoded route
        // segments can differ for slugs containing spaces or other characters.
        const plausibleCount = plausiblePageviews.get(page.path)
            ?? plausiblePageviews.get(encodeURI(page.path))
            ?? plausiblePageviews.get(decodeURI(page.path))
            ?? 0;
        const pageviews = Math.max(0, abacusPageviews - plausibleCount);
        if (options.dedupe && pageviews === 0 && abacusPageviews < plausibleCount) {
            console.error(`Warning: Plausible exceeds Abacus for ${page.path}; exporting 0.`);
        }
        rows.push([options.date, options.hostname, page.path, pageviews].map(csvCell).join(","));
        console.error(`[${index + 1}/${pages.length}] ${page.path}: Abacus ${abacusPageviews} - Plausible ${plausibleCount} = ${pageviews}`);
    }

    writeFileSync(options.output, `${rows.join("\n")}\n`);
    console.log(`Wrote ${options.output}`);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
