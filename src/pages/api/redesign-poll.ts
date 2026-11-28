import type { APIRoute } from "astro";
import { parsePollVote, type PollVote } from "../../lib/redesign-poll";

export const prerender = false;

interface StoredVote extends PollVote {
  slackId: string | null;
  name: string | null;
  submittedAt: string;
}

// Where votes go has not been decided. Until it is, nothing is stored and the
// form tells the voter so. Replace this with the real store; return true once
// the vote is saved.
async function storeVote(_vote: StoredVote): Promise<boolean> {
  return false;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const POST: APIRoute = async ({ request, locals }) => {
  const vote = parsePollVote(await request.json().catch(() => null));
  if (!vote) {
    return json({ error: "Pick new or old for every question." }, 400);
  }

  const stored = await storeVote({
    ...vote,
    slackId: locals.user?.slackId ?? null,
    name: locals.user?.name ?? null,
    submittedAt: new Date().toISOString(),
  });

  if (!stored) {
    return json(
      { error: "Voting isn't open yet, so this wasn't saved. Your picks stay in this tab." },
      503
    );
  }

  return json({ ok: true }, 200);
};
