import type { APIRoute } from "astro";

export const GET: APIRoute = async ({ params }) => {
  const id = params.id;

  if (!id || !/^[UW][A-Z0-9]+$/i.test(id)) {
    return new Response(JSON.stringify({ error: "Invalid Slack user ID" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const response = await fetch(`https://cachet.hackclub.com/get/users/${encodeURIComponent(id)}`, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return new Response(null, {
        status: response.status,
        headers: { "Cache-Control": "public, max-age=300" },
      });
    }

    return new Response(await response.text(), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    });
  } catch {
    return new Response(null, {
      status: 502,
      headers: { "Cache-Control": "public, max-age=60" },
    });
  }
};
