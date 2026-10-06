import columnConfig from "../data/slack-columns.json";

export type SlackColumnConfig = {
  column: string;
  channelId?: string;
  title: string;
  description?: string;
  homepage?: boolean;
  homepageLimit?: number;
  homepageFetchLimit?: number;
  homepageMessagesPerRow?: number;
  authRequired?: boolean;
  showMetadata?: boolean;
  limit?: number;
  subtitle?: string;
  rss?: boolean;
  noun?: string;
  // Messages are articles for the site's markdown columns (opinion, news,
  // essays). Each message names its column, and may name an author and a
  // publish date, in its metadata.
  markdownColumns?: boolean;
};

export type IndigestMessage = {
  slackTs: string;
  channelId: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: string;
  metadata?: Record<string, unknown> | string;
};

export type IndigestMetadataSchema = {
  title?: string;
  fields?: Array<{
    action_id: string;
    label: string;
    type?: string;
  }>;
};

export type SlackColumn = SlackColumnConfig & {
  messages: IndigestMessage[];
  metadataSchema?: IndigestMetadataSchema;
};

const configuredColumns = columnConfig as SlackColumnConfig[];

// A hanging Indigest should fail like a down one, not hold the request open
// until the platform times it out.
export const INDIGEST_TIMEOUT_MS = 4000;

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const responseCache = new Map<string, CacheEntry<unknown>>();
const inFlightRequests = new Map<string, Promise<unknown>>();

function getCacheTtl(): number {
  const configured = Number(import.meta.env.INDIGEST_CACHE_TTL_MS);
  if (Number.isFinite(configured) && configured >= 0) return configured;
  return 60_000;
}

async function getCached<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const cached = responseCache.get(key) as CacheEntry<T> | undefined;
  const pending = inFlightRequests.get(key) as Promise<T> | undefined;

  if (cached) {
    if (cached.expiresAt <= now && !pending) {
      void startCachedRequest(key, loader).catch(() => undefined);
    }
    return cached.value;
  }

  if (pending) return pending;

  return startCachedRequest(key, loader);
}

function startCachedRequest<T>(
  key: string,
  loader: () => Promise<T>,
): Promise<T> {
  const request = loader()
    .then((value) => {
      responseCache.set(key, {
        value,
        expiresAt: Date.now() + getCacheTtl(),
      });
      return value;
    })
    .finally(() => {
      inFlightRequests.delete(key);
    });

  inFlightRequests.set(key, request);
  return request;
}

// An Indigest outage or a rejected key should empty a Slack column, not take
// the page down with a 500. Failures are not cached, so the next request
// retries.
async function withFallback<T>(
  label: string,
  fallback: T,
  load: () => Promise<T>,
): Promise<T> {
  try {
    return await load();
  } catch (error) {
    console.error(`Unable to load Indigest ${label}`, error);
    return fallback;
  }
}

export function getSlackColumns(): SlackColumnConfig[] {
  return configuredColumns;
}

export function getSlackColumn(channel: string): SlackColumnConfig | undefined {
  return configuredColumns.find((column) => column.column === channel);
}

export async function getIndigestMessages(
  channel: string,
  limit = getSlackColumn(channel)?.limit ?? 12,
): Promise<IndigestMessage[]> {
  const apiKey = import.meta.env.INDIGEST_API_KEY;
  if (!apiKey) {
    console.warn("INDIGEST_API_KEY is not configured");
    return [];
  }

  const apiURL =
    import.meta.env.INDIGEST_API_URL ?? "https://indigest.matmanna.dev";
  const url = new URL("/api/messages", apiURL);
  url.searchParams.set("channel", channel);
  url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 10000)));

  return withFallback(`channel ${channel}`, [] as IndigestMessage[], () =>
    getCached(`messages:${url.toString()}`, async () => {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(INDIGEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(
          `Indigest returned ${response.status} for channel ${channel}`,
        );
      }

      const payload = (await response.json()) as { data?: IndigestMessage[] };
      return payload.data ?? [];
    }),
  );
}

export async function getIndigestMessage(
  channel: string,
  slackTs: string,
): Promise<IndigestMessage | undefined> {
  const apiKey = import.meta.env.INDIGEST_API_KEY;
  if (!apiKey) return undefined;

  const apiURL =
    import.meta.env.INDIGEST_API_URL ?? "https://indigest.matmanna.dev";
  const url = new URL(`/api/messages/${encodeURIComponent(slackTs)}`, apiURL);
  url.searchParams.set("channel", channel);

  return withFallback(`message ${slackTs}`, undefined, () =>
    getCached(`message:${url.toString()}`, async () => {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(INDIGEST_TIMEOUT_MS),
      });
      if (response.status === 404) {
        // Keep permalinks working if the single-message endpoint misses a message
        // that is still returned by the channel listing endpoint.
        const messages = await getIndigestMessages(channel, 10000);
        return messages.find((message) => message.slackTs === slackTs);
      }
      if (!response.ok)
        throw new Error(
          `Indigest returned ${response.status} for message ${slackTs}`,
        );

      const payload = (await response.json()) as
        | IndigestMessage
        | { data?: IndigestMessage };
      return ("data" in payload ? payload.data : payload) as
        | IndigestMessage
        | undefined;
    }),
  );
}

export function slackLinkFromMessageId(channelId: string, slackTs: string) {
  return `https://hackclub.slack.com/archives/${channelId}/p${slackTs.replace(".", "")}`;
}

export async function getIndigestMetadataSchema(
  channel: string,
): Promise<IndigestMetadataSchema | undefined> {
  try {
    const apiKey = import.meta.env.INDIGEST_API_KEY;
    if (!apiKey) return undefined;

    const apiURL =
      import.meta.env.INDIGEST_API_URL ?? "https://indigest.matmanna.dev";
    // Await here so a failed request lands in the catch below instead of
    // escaping as a rejected promise and failing the whole page.
    return await getCached(`schema:${apiURL}:${channel}`, async () => {
      const response = await fetch(
        `${apiURL}/api/channels/${encodeURIComponent(channel)}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(INDIGEST_TIMEOUT_MS),
        },
      );
      if (!response.ok) return undefined;

      const payload = (await response.json()) as {
        data?: {
          metadata?: IndigestMetadataSchema | string;
          metadataSchema?: IndigestMetadataSchema | string;
          channel?: {
            metadata?: IndigestMetadataSchema | string;
            metadataSchema?: IndigestMetadataSchema | string;
          };
        };
        metadata?: IndigestMetadataSchema | string;
        metadataSchema?: IndigestMetadataSchema | string;
        channel?: {
          metadata?: IndigestMetadataSchema | string;
          metadataSchema?: IndigestMetadataSchema | string;
        };
      };
      const channelData = payload.data ?? payload;
      const rawMetadata =
        channelData.metadataSchema ??
        channelData.metadata ??
        channelData.channel?.metadataSchema ??
        channelData.channel?.metadata;
      if (!rawMetadata) return undefined;
      if (typeof rawMetadata === "object") return rawMetadata;

      const parsed = JSON.parse(rawMetadata);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : undefined;
    });
  } catch {
    return undefined;
  }
}

export async function getSlackColumnData(
  channel: string,
  limitOverride?: number,
): Promise<SlackColumn | undefined> {
  const config = getSlackColumn(channel);
  if (!config) return undefined;

  try {
    const [messages, metadataSchema] = await Promise.all([
      getIndigestMessages(
        config.channelId ?? channel,
        limitOverride ?? config.limit,
      ),
      getIndigestMetadataSchema(config.channelId ?? channel),
    ]);
    return {
      ...config,
      messages,
      metadataSchema,
    };
  } catch (error) {
    console.error(`Unable to load Indigest channel ${channel} `, error);
    return { ...config, messages: [] };
  }
}

function parseMetadata(
  metadata: IndigestMessage["metadata"],
): Record<string, unknown> | undefined {
  if (metadata && typeof metadata === "object") return metadata;
  if (typeof metadata !== "string") return undefined;

  try {
    const value = JSON.parse(metadata);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function metadataText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (value !== undefined && value !== null) return String(value);
  return undefined;
}

export function firstMetadataValue(
  metadata: IndigestMessage["metadata"],
): string | undefined {
  const parsed = parseMetadata(metadata);
  return metadataText(parsed ? Object.values(parsed)[0] : undefined);
}

// Matches "publishdate", "publish_date", "Publish Date" and so on.
const normalizeFieldName = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]/g, "");

function metadataField(
  metadata: IndigestMessage["metadata"],
  name: string,
): string | undefined {
  const parsed = parseMetadata(metadata);
  if (!parsed) return undefined;

  const wanted = normalizeFieldName(name);
  const entry = Object.entries(parsed).find(
    ([key]) => normalizeFieldName(key) === wanted,
  );
  return metadataText(entry?.[1]);
}

function messageDate(message: IndigestMessage): Date {
  const parsed = new Date(message.timestamp);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const timestamp = Number(message.timestamp || message.slackTs);
  return Number.isFinite(timestamp)
    ? new Date(timestamp * 1000)
    : new Date(NaN);
}

// The site's markdown columns, which integrations with markdownColumns can
// publish into.
export const MARKDOWN_COLUMNS = ["news", "opinion", "essays"];

export type SlackArticle = {
  title: string;
  // The site column the message belongs in.
  column: string;
  url: string;
  // Set only when the metadata names an author; otherwise the poster is the
  // author.
  author?: string;
  date: Date;
  // False when the publish date names a day but no time.
  hasTime: boolean;
};

// Accepts what Slack's date pickers produce: a day ("2026-10-06") or epoch
// seconds, as well as any string Date understands. A bare day is read at noon
// UTC so it shows as the same day in every US timezone.
function parsePublishDate(
  value: string | undefined,
): { date: Date; hasTime: boolean } | undefined {
  if (!value) return undefined;

  let parsed: { date: Date; hasTime: boolean };
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    parsed = { date: new Date(`${value}T12:00:00Z`), hasTime: false };
  } else if (/^\d+$/.test(value)) {
    parsed = { date: new Date(Number(value) * 1000), hasTime: true };
  } else {
    parsed = { date: new Date(value), hasTime: true };
  }
  return Number.isNaN(parsed.date.getTime()) ? undefined : parsed;
}

function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Reads a message as an article. Integrations with markdown columns take the
// title and column from the message metadata, and skip messages without
// them. They also take the slug, author and publish date from it when given,
// and otherwise use the title, who posted the message and when.
export function getSlackArticle(
  message: IndigestMessage,
  column: SlackColumnConfig,
): SlackArticle | undefined {
  if (!column.markdownColumns) {
    return {
      title: firstMetadataValue(message.metadata) ?? column.title,
      column: column.column,
      url: `/slack/${encodeURIComponent(column.column)}/${encodeURIComponent(message.slackTs)}/`,
      date: messageDate(message),
      hasTime: true,
    };
  }

  const title = metadataField(message.metadata, "title");
  const articleColumn = metadataField(
    message.metadata,
    "column",
  )?.toLowerCase();
  if (!title || !articleColumn || !MARKDOWN_COLUMNS.includes(articleColumn)) {
    return undefined;
  }

  // A given slug is cleaned up the same way as one made from the title.
  const slug =
    slugify(metadataField(message.metadata, "slug") ?? "") ||
    slugify(title) ||
    message.slackTs.replace(".", "-");
  return {
    title,
    column: articleColumn,
    url: `/${articleColumn}/${slug}/`,
    author: metadataField(message.metadata, "author"),
    ...(parsePublishDate(metadataField(message.metadata, "publishdate")) ?? {
      date: messageDate(message),
      hasTime: true,
    }),
  };
}

export type MarkdownColumnArticle = {
  integration: SlackColumnConfig;
  message: IndigestMessage;
  article: SlackArticle;
};

// Every article from integrations with markdown columns. Protected ones are
// left out unless includeProtected is set.
export async function getMarkdownColumnArticles(
  includeProtected: boolean,
): Promise<MarkdownColumnArticle[]> {
  const integrations = configuredColumns.filter(
    (column) =>
      column.markdownColumns && (!column.authRequired || includeProtected),
  );
  const loaded = await Promise.all(
    integrations.map(async (integration) => ({
      integration,
      messages: await getIndigestMessages(
        integration.channelId ?? integration.column,
        integration.limit,
      ),
    })),
  );

  return loaded.flatMap(({ integration, messages }) =>
    messages.flatMap((message) => {
      const article = getSlackArticle(message, integration);
      return article ? [{ integration, message, article }] : [];
    }),
  );
}
