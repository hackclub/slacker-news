import type { APIRoute } from "astro";
import { getSlackColumns } from "../../../lib/indigest";
import { getSlackColumnHeadlines } from "../../../lib/ticker-headlines";

// The newswire renders article headlines with the page, then fetches each
// Slack column here so they stream in one by one as Indigest answers.
export const GET: APIRoute = async ({ params, locals }) => {
  const column = getSlackColumns().find(
    (candidate) => candidate.column === params.column,
  );
  if (!column || (column.authRequired && !locals.user)) {
    return new Response("Not found", { status: 404 });
  }

  const headlines = await getSlackColumnHeadlines(column).catch(() => []);
  return Response.json(headlines, {
    headers: {
      // Protected columns must not land in a shared cache.
      "Cache-Control": column.authRequired
        ? "private, max-age=300"
        : "public, max-age=300",
    },
  });
};
