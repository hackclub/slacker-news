import { getEmDashCollection, getEmDashEntry } from "emdash";
import { getDb } from "emdash/runtime";
import { sql } from "kysely";
import { portableTextToMdx } from "../../cms/rich/to-mdx";
import { renderMdx, renderSlackText } from "../mdx-runtime";
import type {
  ChangelogData,
  PageData,
  Person,
  PostData,
  SourceEntry,
} from "./types";

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
/** Portable Text comes back as an array, or as JSON text from some paths. */
function portableText(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

type Credit = {
  byline?: {
    displayName?: string;
    customFields?: Record<string, unknown>;
  };
};

/**
 * The people credited in the editor's Bylines section. They replace the old
 * `author` text, which still serves entries nobody has credited yet.
 */
function credits(data: Fields): { names: string[]; slackIds: string[] } {
  const names: string[] = [];
  const slackIds: string[] = [];
  for (const credit of (data.bylines as Credit[] | undefined) ?? []) {
    const name = text(credit.byline?.displayName);
    if (!name) continue;
    names.push(name);
    slackIds.push(text(credit.byline?.customFields?.slack_id) ?? "");
  }
  return { names, slackIds };
}

function authors(data: Fields): {
  author?: string | string[];
  authorSlackIds?: string[];
} {
  const { names, slackIds } = credits(data);
  if (names.length === 0) return { author: list(data.author) };
  return {
    author: names.length > 1 ? names : names[0],
    authorSlackIds: slackIds,
  };
}

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
  // An article written in the rich-text editor becomes MDX here, then is drawn
  // like any other.
  const rich = fields.body_format === "rich";
  const body = rich
    ? portableTextToMdx(portableText(fields.body_rich))
    : (text(fields.body) ?? "");
  const render = fields.body_format === "slack" ? renderSlackText : renderMdx;
  return { id, data, body, render: () => render(body) };
}

export async function loadPosts(): Promise<SourceEntry<PostData>[]> {
  const entries = await loadAll("posts");
  return entries.flatMap(({ id: slug, data }) => {
    // The category is a taxonomy term, picked in the editor's sidebar. An
    // article without one has no address, so it stays off the site.
    const terms = (
      data.terms as Record<string, { slug?: string }[]> | undefined
    )?.category;
    const category = text(terms?.[0]?.slug);
    if (!category) {
      console.warn(`CMS post "${slug}" has no category, so it is not shown.`);
      return [];
    }
    const id = `${category}/${slug}`;
    return entry<PostData>(
      id,
      {
        id: text(data.legacy_id),
        title: text(data.title) ?? slug,
        date: date(data.date, id),
        ...authors(data),
        excerpt: text(data.excerpt),
        responseTo: list(data.response_to),
        followUpTo: list(data.follow_up_to),
        // SQLite hands booleans back as 0 or 1.
        membersOnly: data.members_only === true || data.members_only === 1,
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
        author: authors(data).author ?? "",
        authorSlackIds: authors(data).authorSlackIds,
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
  // `emdash dev` generates types for the collections; the fields are read by
  // name here, so the generated shape is deliberately not relied on.
  const data = found.data as unknown as Fields;
  return entry<PageData>(slug, { title: text(data.title) }, data);
}

/**
 * Everyone with a byline, with the Slack ID and roles kept on it. Nothing in
 * EmDash's site API lists bylines, so this reads them from the database.
 */
export async function loadPeople(): Promise<Person[] | undefined> {
  const { rows } = await sql<{
    display_name: string;
    slack_id: string | null;
    roles: string | null;
  }>`
    select b.display_name, s.value as slack_id, r.value as roles
      from _emdash_bylines b
      left join _emdash_byline_fields sf on sf.slug = 'slack_id'
      left join _emdash_byline_field_values s
        on s.byline_id = b.id and s.field_id = sf.id
      left join _emdash_byline_fields rf on rf.slug = 'roles'
      left join _emdash_byline_field_values r
        on r.byline_id = b.id and r.field_id = rf.id
     order by b.display_name collate nocase
  `.execute(await getDb());
  if (rows.length === 0) return undefined;
  // A byline field's value is stored as JSON.
  const stored = (value: string | null): string | undefined => {
    if (value === null) return undefined;
    try {
      return text(JSON.parse(value));
    } catch {
      return undefined;
    }
  };
  return rows.map((row) => ({
    name: row.display_name,
    slackId: stored(row.slack_id),
    roles: (stored(row.roles) ?? "")
      .split(",")
      .map((role) => role.trim())
      .filter(Boolean),
  }));
}
