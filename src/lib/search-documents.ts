import { getPosts } from "./content";
import { getSlackColumns, getIndigestMessages } from "./indigest";
import {
  buildSearchIndex,
  slackMessageToDocument,
  termFrequency,
  type SearchAuthor,
  type SearchDocument,
  type SearchIndex,
} from "./search";
import { getSlackUserDisplayName } from "./slack-users";
import { avatarSrc } from "./avatars";

const displayName = async (slackId: string, fallback?: string) =>
  (await getSlackUserDisplayName(slackId)) ??
  fallback?.replace(/^@+/, "") ??
  "Slack user";

// Names and profile pictures for result cards, and real names in place of
// the @{ID} mention placeholders Slack documents carry. Lookups are shared
// with the rest of the site, so each user is fetched once.
async function resolveDocument(doc: SearchDocument): Promise<SearchDocument> {
  const authors: SearchAuthor[] = await Promise.all(
    (doc.authorRefs ?? []).map(async ({ handle, slackId }) =>
      slackId
        ? {
            name: await displayName(slackId, handle),
            slackId,
            avatar: await avatarSrc(slackId),
          }
        : { name: handle ?? "" },
    ),
  );

  const ids = [
    ...new Set(
      [...doc.text.matchAll(/@\{([UW][A-Z0-9]+)\}/g)].map((match) => match[1]),
    ),
  ];
  const names = new Map(
    await Promise.all(
      ids.map(async (id) => [id, await displayName(id)] as const),
    ),
  );
  const named = (text: string) =>
    text.replace(/@\{([UW][A-Z0-9]+)\}/g, (_match, id) => `@${names.get(id)}`);
  const text = named(doc.text);

  const { authorRefs: _refs, ...rest } = doc;
  return {
    ...rest,
    authors: authors.filter((author) => author.name),
    excerpt: named(doc.excerpt),
    text,
    mentions: [...(doc.mentions ?? []), ...names.values()],
    bodyTerms: ids.length > 0 ? termFrequency(text) : doc.bodyTerms,
  };
}

// Building the index means reading every post, fetching every Slack column
// and looking people up, so keep each build for a few minutes. Signed-in
// readers get their own copy, since it includes members-only columns.
const BUILD_TTL_MS = 5 * 60 * 1000;
const builds = new Map<boolean, { at: number; index: Promise<SearchIndex> }>();

export function getSearchIndex(authenticated: boolean): Promise<SearchIndex> {
  const cached = builds.get(authenticated);
  if (cached && Date.now() - cached.at < BUILD_TTL_MS) return cached.index;
  const index = buildIndex(authenticated);
  builds.set(authenticated, { at: Date.now(), index });
  index.catch(() => {
    if (builds.get(authenticated)?.index === index)
      builds.delete(authenticated);
  });
  return index;
}

async function buildIndex(authenticated: boolean): Promise<SearchIndex> {
  const posts = await getPosts();

  const columns = getSlackColumns();

  const slackDocs: SearchDocument[] = [];

  await Promise.all(
    columns
      .filter((col) => !col.authRequired || authenticated)
      .map(async (col) => {
        try {
          const messages = await getIndigestMessages(
            col.channelId ?? col.column,
            col.limit,
          );
          for (const msg of messages) {
            const doc = slackMessageToDocument(msg, col);
            if (doc) slackDocs.push(doc);
          }
        } catch (err) {
          console.error(
            `Failed to fetch Slack column ${col.column} for search index:`,
            err,
          );
        }
      }),
  );

  const index = buildSearchIndex(posts, slackDocs);
  index.documents = await Promise.all(index.documents.map(resolveDocument));

  return index;
}
