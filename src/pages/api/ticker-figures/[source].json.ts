import type { APIRoute } from "astro";
import { getClubsFigures } from "../../../lib/clubs";
import { getTickerFigures, type TickerFigure } from "../../../lib/otter";
import { getSlackDataFigures } from "../../../lib/slack-data";

// The newswire loads its headlines first, then fetches each figure source
// separately so a slow API only delays its own figures.
const sources: Record<string, () => Promise<TickerFigure[]>> = {
  otter: getTickerFigures,
  clubs: getClubsFigures,
  "slack-data": getSlackDataFigures,
};

export const GET: APIRoute = async ({ params }) => {
  const load = params.source ? sources[params.source] : undefined;
  if (!load) return new Response("Not found", { status: 404 });

  return Response.json(await load(), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
};
