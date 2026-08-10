import columns from "../src/data/slack-columns.json" with { type: "json" };

type Message = {
  slackTs?: string;
  userId?: string;
  text?: string;
};

const apiKey = process.env.INDIGEST_API_KEY;
const indigestURL = process.env.INDIGEST_API_URL ?? "https://indigest.matmanna.dev";
const timeoutMs = Number(process.env.SLACK_PROFILE_TIMEOUT_MS ?? 15000);
const requestedChannel = process.argv.find((arg) => arg.startsWith("--channel="))?.split("=", 2)[1];
const requestedMessage = process.argv.find((arg) => arg.startsWith("--message-id="))?.split("=", 2)[1];

if (!apiKey) {
  console.error("INDIGEST_API_KEY is not configured. Load the project .env before running this script.");
  process.exit(1);
}

const selectedColumns = columns.filter((column) =>
  column.homepage && (!requestedChannel || column.channel === requestedChannel)
);

if (selectedColumns.length === 0) {
  console.error(`No homepage column matched ${requestedChannel ?? "the configured columns"}.`);
  process.exit(1);
}

function elapsed(start: number): number {
  return Math.round((performance.now() - start) * 10) / 10;
}

async function timedFetch(name: string, url: string, init: RequestInit = {}) {
  const start = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.text();
    return {
      name,
      url,
      status: response.status,
      ms: elapsed(start),
      bytes: Buffer.byteLength(body),
      body
    };
  } catch (error) {
    return {
      name,
      url,
      status: 0,
      ms: elapsed(start),
      bytes: 0,
      body: "",
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
}

function parseMessages(body: string): Message[] {
  try {
    const payload = JSON.parse(body) as { data?: Message[] } | Message[];
    return Array.isArray(payload) ? payload : payload.data ?? [];
  } catch {
    return [];
  }
}

function parseMessage(body: string): Message | undefined {
  try {
    const payload = JSON.parse(body) as Message | { data?: Message };
    return ("data" in payload ? payload.data : payload) as Message | undefined;
  } catch {
    return undefined;
  }
}

function uniqueMatches(text: string, pattern: RegExp): string[] {
  return [...new Set([...text.matchAll(pattern)].map((match) => match[1]))];
}

function printResult(result: Awaited<ReturnType<typeof timedFetch>>) {
  const suffix = result.error
    ? `error=${result.error}`
    : `status=${result.status} bytes=${result.bytes}`;
  console.log(`${result.ms.toFixed(1).padStart(7)} ms  ${result.name}  ${suffix}`);
}

for (const column of selectedColumns) {
  const channelId = column.channelId ?? column.channel;
  const limit = Math.min(Math.max(column.limit ?? 12, 1), 10000);
  console.log(`\n## ${column.title} (${column.channel} / ${channelId})`);

  const messagesURL = new URL("/api/messages", indigestURL);
  messagesURL.searchParams.set("channel", channelId);
  messagesURL.searchParams.set("limit", String(limit));
  const schemaURL = new URL(`/api/channels/${encodeURIComponent(channelId)}`, indigestURL);

  const columnStart = performance.now();
  const [messagesResult, schemaResult] = await Promise.all([
    timedFetch("Indigest messages", messagesURL.toString(), { headers: authHeaders() }),
    timedFetch("Indigest schema", schemaURL.toString(), { headers: authHeaders() })
  ]);
  printResult(messagesResult);
  printResult(schemaResult);
  console.log(`  simulated column fetch: ${elapsed(columnStart).toFixed(1)} ms (Promise.all critical path)`);

  const messages = parseMessages(messagesResult.body);
  let directMessage: Message | undefined;
  if (requestedMessage) {
    const directURL = new URL(`/api/messages/${encodeURIComponent(requestedMessage)}`, indigestURL);
    directURL.searchParams.set("channel", channelId);
    const directResult = await timedFetch("Indigest single message", directURL.toString(), { headers: authHeaders() });
    printResult(directResult);
    directMessage = parseMessage(directResult.body);
    console.log(`  simulated direct page data path: ${Math.max(directResult.ms, schemaResult.ms).toFixed(1)} ms (message and schema run in parallel)`);
  }
  const selectedMessage = requestedMessage
    ? [directMessage ?? messages.find((message) => message.slackTs === requestedMessage)].filter((message): message is Message => Boolean(message))
    : messages.slice(0, Math.min(messages.length, column.homepageLimit ?? 5));
  const users = [...new Set(selectedMessage
    .map((message) => message.userId)
    .filter((userId): userId is string => Boolean(userId))
  )].slice(0, 10);
  const channelNames = [...new Set(selectedMessage.flatMap((message) =>
    uniqueMatches(message.text ?? "", /(?:^|\s)#([A-Za-z0-9][A-Za-z0-9_-]*)/g)
  ))].slice(0, 10);
  const emojiNames = [...new Set(selectedMessage.flatMap((message) =>
    uniqueMatches(message.text ?? "", /:([A-Za-z0-9_+\-]+):/g)
  ))].slice(0, 10);

  console.log(`  messages returned=${messages.length}; sampled users=${users.length}, channel candidates=${channelNames.length}, emojis=${emojiNames.length}`);

  const enrichmentRequests = [
    ...users.map((userId) => timedFetch(`Cachet user ${userId}`, `https://cachet.hackclub.com/get/users/${encodeURIComponent(userId)}`)),
    ...channelNames.map((name) => timedFetch(`Flaron channel #${name}`, `https://flaron.halceon.dev/channel/${encodeURIComponent(name)}`)),
    ...emojiNames.map((name) => timedFetch(`Cachet emoji :${name}:`, `https://cachet.hackclub.com/emojis/${encodeURIComponent(name)}/r`))
  ];

  const enrichmentStart = performance.now();
  const enrichmentResults = await Promise.all(enrichmentRequests);
  for (const result of enrichmentResults) printResult(result);
  if (enrichmentResults.length > 0) {
    const slowest = Math.max(...enrichmentResults.map((result) => result.ms));
    console.log(`  sampled enrichment wall time: ${elapsed(enrichmentStart).toFixed(1)} ms; slowest=${slowest.toFixed(1)} ms`);
  }
}
