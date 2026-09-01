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

  return getCached(`messages:${url.toString()}`, async () => {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Indigest returned ${response.status} for channel ${channel}`,
      );
    }

    const payload = (await response.json()) as { data?: IndigestMessage[] };
    return payload.data ?? [];
  });
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

  return getCached(`message:${url.toString()}`, async () => {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
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
  });
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
    return getCached(`schema:${apiURL}:${channel}`, async () => {
      const response = await fetch(
        `${apiURL}/api/channels/${encodeURIComponent(channel)}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
          },
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

export function firstMetadataValue(
  metadata: IndigestMessage["metadata"],
): string | undefined {
  let parsed: Record<string, unknown> | undefined;

  if (typeof metadata === "string") {
    try {
      const value = JSON.parse(metadata);
      if (value && typeof value === "object" && !Array.isArray(value))
        parsed = value;
    } catch {
      return undefined;
    }
  } else if (metadata && typeof metadata === "object") {
    parsed = metadata;
  }

  const value = parsed ? Object.values(parsed)[0] : undefined;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value !== undefined && value !== null) return String(value);
  return undefined;
}
