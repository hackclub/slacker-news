import type { APIRoute } from "astro";

// A Slack profile picture at 72px, fetched once and served from our own
// domain with long cache headers. Browsers and the CDN keep it, so a page of
// bylines costs no redirect through Cachet to Slack per picture per view.
// Pictures change rarely; a day in the browser and a week at the CDN (served
// stale while it refreshes) keeps them close to current.
const CACHE =
  "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800";
const MAX_BYTES = 2 * 1024 * 1024;

export const GET: APIRoute = async ({ params }) => {
  const id = params.id ?? "";
  if (!/^[UW][A-Z0-9]+$/.test(id)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    // Cachet names the Slack image; Slack serves each picture at several
    // sizes, and 72px is plenty for avatars shown at 20-40px.
    const lookup = await fetch(
      `https://cachet.hackclub.com/users/${encodeURIComponent(id)}`,
      {
        headers: { Accept: "application/json" },
      },
    );
    const imageUrl = lookup.ok
      ? ((await lookup.json()) as { imageUrl?: unknown }).imageUrl
      : undefined;
    if (typeof imageUrl !== "string" || !imageUrl.startsWith("https://")) {
      return new Response("Not found", {
        status: 404,
        headers: { "Cache-Control": "public, max-age=3600" },
      });
    }
    const small = imageUrl.replace(
      /_(\d+|original)\.(png|jpe?g|gif|webp)$/i,
      "_72.$2",
    );

    let upstream = await fetch(small);
    if (!upstream.ok && small !== imageUrl) upstream = await fetch(imageUrl);
    const type = upstream.headers.get("content-type") ?? "";
    if (!upstream.ok || !type.startsWith("image/")) {
      return new Response("Not found", {
        status: 404,
        headers: { "Cache-Control": "public, max-age=3600" },
      });
    }
    const body = await upstream.arrayBuffer();
    if (body.byteLength > MAX_BYTES) {
      return new Response("Not found", { status: 404 });
    }
    return new Response(body, {
      headers: { "Content-Type": type, "Cache-Control": CACHE },
    });
  } catch {
    // Cachet or Slack unreachable: don't cache the miss for long.
    return new Response("Unavailable", {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
};
