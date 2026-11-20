import type { APIRoute } from "astro";
import { getPosts } from "../lib/content";
import { getSlackColumns, getIndigestMessages } from "../lib/indigest";
import {
  buildSearchIndex,
  slackMessageToDocument,
  termFrequency,
  type SearchAuthor,
  type SearchDocument,
} from "../lib/search";
import { getSlackUserDisplayName } from "../lib/slack-users";
import { avatarSrc } from "../lib/avatars";

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

export const GET: APIRoute = async ({ locals }) => {
  const posts = await getPosts();

  const columns = getSlackColumns();
  const user = (locals as any)?.user;
  const slackDocs: SearchDocument[] = [];

  await Promise.all(
    columns
      .filter((col) => !col.authRequired || user)
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

  return new Response(JSON.stringify(index), {
    headers: { "content-type": "application/json" },
  });
};
