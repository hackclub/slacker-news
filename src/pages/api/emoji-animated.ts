import type { APIRoute } from "astro";

export const prerender = false;

// Whether a Slack emoji animates, for the redesign poll's preview. Cachet
// redirects each emoji to its image on Slack's CDN, which allows no
// cross-origin reads, so the browser cannot inspect the file itself. Custom
// animated emoji are GIFs and standard emoji are PNGs, so the redirect's
// extension is the answer.
export const GET: APIRoute = async ({ url }) => {
  const name = url.searchParams.get("name") ?? "";
  if (!/^[\w+'-]{1,100}$/.test(name)) {
    return new Response(JSON.stringify({ animated: false }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  let animated = false;
  try {
    const response = await fetch(
      `https://cachet.hackclub.com/emojis/${encodeURIComponent(name)}/r`,
      { redirect: "manual" }
    );
    const location = response.headers.get("location") ?? "";
    animated = new URL(location, "https://cachet.hackclub.com").pathname
      .toLowerCase()
      .endsWith(".gif");
  } catch {
    animated = false;
  }

  return new Response(JSON.stringify({ animated }), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=86400",
    },
  });
};
