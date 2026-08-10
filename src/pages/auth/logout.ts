import type { APIRoute } from "astro";
import { getAuth } from "../../lib/auth";

export const GET: APIRoute = async ({ request }) => {
  const response = await getAuth().api.signOut({
    headers: request.headers,
    asResponse: true,
  });

  const headers = new Headers(response.headers);
  headers.set("Location", "/");
  return new Response(null, { status: 302, headers });
};
