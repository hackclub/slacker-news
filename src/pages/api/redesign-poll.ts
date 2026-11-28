import type { APIRoute } from "astro";
import { createHash } from "node:crypto";
import { parsePollVote, type PollVote } from "../../lib/redesign-poll";

export const prerender = false;

// Votes go to the "Votes" table of the redesign poll's Airtable base. A
// signed-in voter has one row, matched on Slack ID, that each new vote
// replaces. Anonymous votes each add a row, a few per IP a day; the IP is
// stored only as a salted hash.

function env(name: string): string | undefined {
  return process.env[name] ?? (import.meta.env[name] as string | undefined);
}

const ANONYMOUS_VOTES_PER_DAY = 3;

// Poll question key to Airtable field name.
const FIELDS: Record<string, string> = {
  colour: "Colour",
  emoji: "Animated emoji",
  authors: "Authors",
  avatars: "Profile pictures",
  cards: "Homepage stories",
  width: "Homepage width",
  masthead: "Masthead",
  paper: "Background",
  headings: "Section headings",
};

interface StoredVote extends PollVote {
  slackId: string | null;
  name: string | null;
  ipHash: string;
  submittedAt: string;
}

type StoreResult = "saved" | "not-configured" | "rate-limited" | "failed";

async function storeVote(vote: StoredVote): Promise<StoreResult> {
  const token = env("AIRTABLE_TOKEN");
  const baseId = env("AIRTABLE_BASE_ID");
  const table = env("AIRTABLE_TABLE") ?? "Votes";
  if (!token || !baseId) return "not-configured";

  const tableUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  try {
    if (!vote.slackId) {
      const formula = `AND({IP hash} = '${vote.ipHash}', IS_AFTER({Submitted at}, DATEADD(NOW(), -1, 'days')))`;
      const recent = await fetch(
        `${tableUrl}?pageSize=${ANONYMOUS_VOTES_PER_DAY}&fields%5B%5D=IP%20hash&filterByFormula=${encodeURIComponent(formula)}`,
        { headers }
      );
      if (!recent.ok) throw new Error(`Airtable lookup ${recent.status}`);
      const { records } = (await recent.json()) as { records: unknown[] };
      if (records.length >= ANONYMOUS_VOTES_PER_DAY) return "rate-limited";
    }

    const fields: Record<string, string> = {
      "Submitted at": vote.submittedAt,
      "Slack ID": vote.slackId ?? "",
      Name: vote.name ?? "",
      Comments: vote.comments,
      "IP hash": vote.ipHash,
    };
    for (const [key, choice] of Object.entries(vote.choices)) {
      fields[FIELDS[key]] = choice;
    }

    // Signed in: update the voter's row, or add it. Anonymous: always add.
    const response = await fetch(tableUrl, {
      method: vote.slackId ? "PATCH" : "POST",
      headers,
      body: JSON.stringify({
        records: [{ fields }],
        typecast: true,
        ...(vote.slackId ? { performUpsert: { fieldsToMergeOn: ["Slack ID"] } } : {}),
      }),
    });
    if (!response.ok) {
      throw new Error(`Airtable write ${response.status}: ${await response.text()}`);
    }
    return "saved";
  } catch (error) {
    console.error("Redesign poll vote not saved:", error);
    return "failed";
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function hashIp(request: Request, clientAddress: string | undefined): string {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || clientAddress || "unknown";
  return createHash("sha256")
    .update(`${env("POLL_IP_SALT") ?? ""}:${ip}`)
    .digest("hex");
}

export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  const vote = parsePollVote(await request.json().catch(() => null));
  if (!vote) {
    return json({ error: "Pick new or old for every question." }, 400);
  }

  let address: string | undefined;
  try {
    address = clientAddress;
  } catch {
    address = undefined;
  }

  const result = await storeVote({
    ...vote,
    slackId: locals.user?.slackId ?? null,
    name: locals.user?.name ?? null,
    ipHash: hashIp(request, address),
    submittedAt: new Date().toISOString(),
  });

  switch (result) {
    case "saved":
      return json({ ok: true }, 200);
    case "rate-limited":
      return json(
        { error: "You've voted a few times today already. Sign in with Hack Club to change your vote." },
        429
      );
    case "not-configured":
      return json(
        { error: "Voting isn't open yet, so this wasn't saved. Your picks stay in this tab." },
        503
      );
    default:
      return json({ error: "Couldn't save your vote. Try again in a moment." }, 502);
  }
};
