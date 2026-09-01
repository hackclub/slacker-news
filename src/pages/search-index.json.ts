import type { APIRoute } from "astro";
import { getPosts } from "../lib/content";
import { getSlackColumns, getIndigestMessages } from "../lib/indigest";
import {
  buildSearchIndex,
  slackMessageToDocument,
  type SearchDocument,
} from "../lib/search";

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
            slackDocs.push(slackMessageToDocument(msg, col));
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

  return new Response(JSON.stringify(index), {
    headers: { "content-type": "application/json" },
  });
};
