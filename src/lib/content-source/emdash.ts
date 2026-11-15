import { getEmDashCollection, getEmDashEntry } from "emdash";
import { renderMdx } from "../mdx-runtime";
import type { ChangelogData, PageData, PostData, SourceEntry } from "./types";

/** Content comes from EmDash. The schema is defined in scripts/build-emdash-seed.ts. */
export const cmsEnabled = true;

type Fields = Record<string, unknown>;

// EmDash pages results; the site wants every entry of a collection.
const PAGE_SIZE = 100;

async function loadAll(
  collection: string,
): Promise<{ id: string; data: Fields }[]> {
  const all: { id: string; data: Fields }[] = [];
  let cursor: string | undefined;
  do {
    const { entries, error, nextCursor } = await getEmDashCollection(
      collection,
      {
        limit: PAGE_SIZE,
        cursor,
        orderBy: { created_at: "desc" },
      },
    );
    if (error) throw error;
    all.push(...(entries as { id: string; data: Fields }[]));
    cursor = nextCursor;
  } while (cursor);
  // A stable order, so entries that share a date do not swap places between requests.
  return all.sort((a, b) => a.id.localeCompare(b.id));
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** "a, b" in a CMS text field means the list ["a", "b"]. */
function list(value: unknown): string | string[] | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const items = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 1 ? items : items[0];
}

function date(value: unknown, id: string): Date {
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `CMS entry "${id}" has an unreadable date: ${JSON.stringify(value)}`,
    );
  }
  return parsed;
}

function entry<Data>(
  id: string,
  data: Data,
  fields: Fields,
): SourceEntry<Data> {
  const body = text(fields.body) ?? "";
  return { id, data, body, render: () => renderMdx(body) };
}

export async function loadPosts(): Promise<SourceEntry<PostData>[]> {
  const entries = await loadAll("posts");
  return entries.map(({ id: slug, data }) => {
    const category = text(data.category);
    if (!category) throw new Error(`CMS post "${slug}" has no category`);
    const id = `${category}/${slug}`;
    return entry<PostData>(
      id,
      {
        id: text(data.legacy_id),
        title: text(data.title) ?? slug,
        date: date(data.date, id),
        author: list(data.author),
        excerpt: text(data.excerpt),
        frontPagePreview: text(data.front_page_preview),
        responseTo: list(data.response_to),
        followUpTo: list(data.follow_up_to),
      },
      data,
    );
  });
}

export async function loadChangelogs(): Promise<SourceEntry<ChangelogData>[]> {
  const entries = await loadAll("changelogs");
  return entries.map(({ id, data }) =>
    entry<ChangelogData>(
      id,
      {
        title: text(data.title) ?? id,
        date: date(data.date, id),
        author: list(data.author) ?? "",
        excerpt: text(data.excerpt),
        responseTo: list(data.response_to),
        followUpTo: list(data.follow_up_to),
      },
      data,
    ),
  );
}

export async function loadPage(
  slug: string,
): Promise<SourceEntry<PageData> | undefined> {
  const { entry: found, error } = await getEmDashEntry("pages", slug);
  if (error) throw error;
  if (!found) return undefined;
  const data = found.data as Fields;
  return entry<PageData>(slug, { title: text(data.title) }, data);
}
