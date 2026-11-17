/**
 * Looks up Slack people and channels for the editor's insert forms. Flaron
 * (https://flaron.halceon.dev) answers searches by name; the editor asks the
 * newsroom plugin, which asks Flaron, because Flaron sets no CORS headers for
 * a browser.
 */
export const FLARON = "https://flaron.halceon.dev";

export type SlackHit = {
  /** Slack's ID: U… for a person, C… for a channel. */
  id: string;
  /** The handle or channel name, without @ or #. */
  name: string;
  /** What to show beside it, such as a real name. */
  detail?: string;
};

export type SlackKind = "users" | "channels";

export function searchUrl(kind: SlackKind, query: string): string {
  return `${FLARON}/${kind}/search?q=${encodeURIComponent(query)}`;
}

/** Reads Flaron's `{ data: [...] }` answer; anything else is no hits. */
export function readHits(
  kind: SlackKind,
  payload: unknown,
  max = 12,
): SlackHit[] {
  const rows = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return [];
  const hits: SlackHit[] = [];
  for (const row of rows as Record<string, unknown>[]) {
    const id = typeof row?.id === "string" ? row.id : "";
    const name = typeof row?.name === "string" ? row.name : "";
    if (!id || !name) continue;
    const real = typeof row.real_name === "string" ? row.real_name : "";
    hits.push({
      id,
      name,
      ...(kind === "users" && real && real !== name ? { detail: real } : {}),
    });
    if (hits.length >= max) break;
  }
  return hits;
}
