import { getCollection, getEntry, render } from "astro:content";
import type {
  ChangelogData,
  PageData,
  Person,
  PostData,
  SourceEntry,
} from "./types";

/** Content comes from the MDX files in src/content. */
export const cmsEnabled = false;

export async function loadPosts(): Promise<SourceEntry<PostData>[]> {
  const entries = await getCollection("posts");
  return entries.map((entry) => ({
    id: entry.id,
    data: entry.data,
    body: entry.body!,
    render: () => render(entry),
  }));
}

export async function loadChangelogs(): Promise<SourceEntry<ChangelogData>[]> {
  const entries = await getCollection("changelogs");
  return entries.map((entry) => ({
    id: entry.id,
    data: entry.data,
    body: entry.body!,
    render: () => render(entry),
  }));
}

export async function loadPage(
  slug: string,
): Promise<SourceEntry<PageData> | undefined> {
  const entry = await getEntry("pages", slug);
  if (!entry) return undefined;
  return {
    id: entry.id,
    data: entry.data,
    body: entry.body!,
    render: () => render(entry),
  };
}

/** The people come from src/data/acknowledgements.json, read by the caller. */
export async function loadPeople(): Promise<Person[] | undefined> {
  return undefined;
}
