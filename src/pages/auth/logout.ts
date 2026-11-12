import type { APIRoute } from "astro";
import { getAuth } from "../../lib/auth";
import { LOGGED_IN_COOKIE } from "../../lib/comments";

export const GET: APIRoute = async ({ request, cookies }) => {
  const response = await getAuth().api.signOut({
    headers: request.headers,
    asResponse: true,
  });

  // The marker that tells the page to show a skeleton for comments.
  cookies.delete(LOGGED_IN_COOKIE, { path: "/" });

  const headers = new Headers(response.headers);
  headers.set("Location", "/");
  return new Response(null, { status: 302, headers });
};
