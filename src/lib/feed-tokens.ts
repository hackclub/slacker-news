import { createHash } from "node:crypto";
import { INDIGEST_TIMEOUT_MS } from "./indigest";

// Private feed links carry an Indigest child key. Slacker News has no
// database, so Indigest stores, scopes and revokes the keys: our own
// INDIGEST_API_KEY is a delegating key, and every reader gets a child of it
// scoped to the protected columns.

export type FeedTokenStatus =
  | { status: "active"; channelIds: string[] }
  | { status: "revoked"; revokedAt: Date | null }
  | { status: "unknown" };

type CacheEntry = {
  value: FeedTokenStatus;
  expiresAt: number;
};

const CACHE_TTL_MS: Record<FeedTokenStatus["status"], number> = {
  active: 5 * 60_000,
  // Revocation is permanent, so a revoked answer can be kept longer.
  revoked: 60 * 60_000,
  unknown: 60_000,
};
const tokenCache = new Map<string, CacheEntry>();

function indigestURL(path: string): URL {
  return new URL(
    path,
    import.meta.env.INDIGEST_API_URL ?? "https://indigest.matmanna.dev",
  );
}

// Key the cache by a hash so raw tokens are never held as map keys.
function cacheKeyFor(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function callIndigest(path: string, body: unknown): Promise<Response> {
  const apiKey = import.meta.env.INDIGEST_API_KEY;
  if (!apiKey) throw new Error("INDIGEST_API_KEY is not configured");

  return fetch(indigestURL(path), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(INDIGEST_TIMEOUT_MS),
  });
}

/**
 * Look up a private feed token. Only tokens this site's key minted count;
 * any other string is "unknown".
 */
export async function getFeedTokenStatus(
  token: string,
): Promise<FeedTokenStatus> {
  if (!token.startsWith("ind_")) return { status: "unknown" };

  const cacheKey = cacheKeyFor(token);
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const response = await callIndigest("/api/api-keys/delegate/status", {
    key: token,
  });
  if (!response.ok)
    throw new Error(`Indigest returned ${response.status} for key status`);

  const payload = (await response.json()) as
    | { status: "active"; channelIds: string[] }
    | { status: "revoked"; revokedAt: string | null }
    | { status: "unknown" };
  const value: FeedTokenStatus =
    payload.status === "revoked"
      ? {
          status: "revoked",
          revokedAt: payload.revokedAt ? new Date(payload.revokedAt) : null,
        }
      : payload;

  tokenCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS[value.status],
  });
  return value;
}

/**
 * Revoke a private feed token by its value. Anyone holding a link may kill
 * it, so a leaked link can be revoked by whoever finds it.
 */
export async function revokeFeedToken(token: string): Promise<boolean> {
  const response = await callIndigest("/api/api-keys/revoke", { key: token });
  if (response.status === 404) return false;
  if (!response.ok)
    throw new Error(`Indigest returned ${response.status} revoking a key`);
  tokenCache.delete(cacheKeyFor(token));
  return true;
}

/**
 * Mint a private feed token for one reader. A reader may hold any number;
 * minting another leaves the earlier ones working. The label names the link
 * in the reader's list ("RSS bot", "Feedly").
 */
export async function mintFeedToken(
  subject: string,
  channelIds: string[],
  label?: string,
): Promise<string> {
  const response = await callIndigest("/api/api-keys/delegate", {
    subject,
    channelIds,
    ...(label ? { label } : {}),
  });
  if (!response.ok)
    throw new Error(`Indigest returned ${response.status} minting a key`);

  const payload = (await response.json()) as { fullKey: string };
  return payload.fullKey;
}

export type FeedTokenSummary = {
  id: number;
  label: string | null;
  // The start of the key, enough to match it against a link.
  keyPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
};

async function callIndigestAt(
  method: "GET" | "DELETE",
  path: string,
): Promise<Response> {
  const apiKey = import.meta.env.INDIGEST_API_KEY;
  if (!apiKey) throw new Error("INDIGEST_API_KEY is not configured");

  return fetch(indigestURL(path), {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(INDIGEST_TIMEOUT_MS),
  });
}

/** One reader's live private links, newest first. */
export async function listFeedTokens(
  subject: string,
): Promise<FeedTokenSummary[]> {
  const response = await callIndigestAt(
    "GET",
    `/api/api-keys/delegate/${encodeURIComponent(subject)}`,
  );
  if (!response.ok)
    throw new Error(`Indigest returned ${response.status} listing keys`);

  const payload = (await response.json()) as {
    keys: Array<{
      id: number;
      label: string | null;
      keyPrefix: string;
      createdAt: string;
      lastUsedAt: string | null;
    }>;
  };
  return payload.keys.map((key) => ({
    ...key,
    createdAt: new Date(key.createdAt),
    lastUsedAt: key.lastUsedAt ? new Date(key.lastUsedAt) : null,
  }));
}

/**
 * Revoke one of a reader's private links by its id. Indigest only revokes it
 * if it belongs to that reader. Readers using it stop getting members-only
 * posts once the cached validation expires (within five minutes).
 */
export async function revokeFeedTokenById(
  subject: string,
  id: number,
): Promise<boolean> {
  const response = await callIndigestAt(
    "DELETE",
    `/api/api-keys/delegate/${encodeURIComponent(subject)}/${id}`,
  );
  if (!response.ok)
    throw new Error(`Indigest returned ${response.status} revoking a key`);
  const payload = (await response.json()) as { revoked: number };
  return payload.revoked > 0;
}

export async function revokeFeedTokens(subject: string): Promise<void> {
  const apiKey = import.meta.env.INDIGEST_API_KEY;
  if (!apiKey) throw new Error("INDIGEST_API_KEY is not configured");

  const response = await fetch(
    indigestURL(`/api/api-keys/delegate/${encodeURIComponent(subject)}`),
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(INDIGEST_TIMEOUT_MS),
    },
  );
  if (!response.ok)
    throw new Error(`Indigest returned ${response.status} revoking keys`);
  // Cached validations of the revoked tokens expire within five minutes.
}
