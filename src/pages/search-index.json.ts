import type { APIRoute } from "astro";
import { getSearchIndex } from "../lib/search-documents";

export const GET: APIRoute = async ({ locals }) => {
  const index = await getSearchIndex(Boolean((locals as any)?.user));
  return new Response(JSON.stringify(index), {
    headers: { "content-type": "application/json" },
  });
};
