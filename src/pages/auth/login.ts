import type { APIRoute } from "astro";
import { getAuth } from "../../lib/auth";

function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export const GET: APIRoute = async ({ request, url }) => {
  // Without this, Hack Club Auth only reports "Missing required parameter:
  // client_id". The auth instance is cached, so restart after setting it.
  if (!import.meta.env.HACKCLUB_CLIENT_ID) {
    console.error("HACKCLUB_CLIENT_ID is not configured");
    return new Response("Login is not configured on this server.", {
      status: 500,
    });
  }

  const callbackURL = safeReturnTo(url.searchParams.get("returnTo"));

  const response = await getAuth().api.signInWithOAuth2({
    body: {
      providerId: "hackclub",
      callbackURL,
      errorCallbackURL: "/auth/error",
    },
    headers: request.headers,
    asResponse: true,
  });

  if (response.status >= 300 && response.status < 400) return response;

  const payload = (await response
    .clone()
    .json()
    .catch(() => null)) as { url?: string; redirect?: boolean } | null;
  if (payload?.redirect && payload.url) {
    const headers = new Headers(response.headers);
    headers.set("Location", payload.url);
    return new Response(null, { status: 302, headers });
  }

  return response;
};
