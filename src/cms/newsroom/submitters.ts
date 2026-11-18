/**
 * Keeps submitters to their own articles.
 *
 * Everyone below the Editor role is a submitter: an outside contributor, to be
 * trusted no more than a member of the public. EmDash's own rules are looser
 * than that (any contributor may read every draft and list every post), so
 * this stands in front of EmDash's API and lets a submitter's request through
 * only if it is on a short list:
 *
 *  - their own session, and the few read-only things the editor needs to draw
 *    itself (the manifest, the taxonomies);
 *  - the list of posts, narrowed to the ones they wrote;
 *  - one post, if they wrote it, or were added to it as a collaborator, who
 *    may read it but not change it;
 *  - the newsroom plugin's routes, which check the same thing themselves
 *    (plugin.ts, `levelOn`).
 *
 * Everything else is refused, including publishing: only editors put things
 * live. What a submitter may write into an article is the plugin's
 * `content:beforeSave` hook, because saves made while co-editing do not come
 * through here.
 */
import type { APIContext, MiddlewareNext } from "astro";
import { getDb } from "emdash/runtime";
import { sql } from "kysely";

const EDITOR = 40;
const API = "/_emdash/api/";
/** The one collection a submitter works in. */
const COLLECTION = "posts";

type User = { id: string; role: number };
type Level = "owner" | "collaborator";

function refuse(message: string): Response {
  return Response.json(
    { success: false, error: { code: "FORBIDDEN", message } },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}

async function levelOn(userId: string, entryId: string): Promise<Level | null> {
  const db = await getDb();
  const post = await sql<{ author_id: string | null }>`
    select author_id from ec_posts where id = ${entryId}
  `.execute(db);
  if (post.rows.length === 0) return null;
  if (post.rows[0].author_id === userId) return "owner";
  const added = await sql`
    select 1 from _plugin_storage
     where plugin_id = 'newsroom' and collection = 'collaborators'
       and id = ${`${entryId}:${userId}`}
  `.execute(db);
  return added.rows.length ? "collaborator" : null;
}

async function entryOfRevision(revisionId: string): Promise<string | null> {
  const found = await sql<{ entry_id: string; collection: string }>`
    select entry_id, collection from revisions where id = ${revisionId}
  `.execute(await getDb());
  const row = found.rows[0];
  return row && row.collection === COLLECTION ? row.entry_id : null;
}

/** What the owner of a post may do under `/content/posts/<id>/…`. */
const OWNER_PARTS = [
  /^room$/,
  /^lock(\/.*)?$/,
  /^revisions$/,
  /^compare$/,
  /^terms\/[\w-]+$/,
  /^preview-url$/,
  /^discard-draft$/,
  /^plugin-extensions\/newsroom\/.+$/,
];
/** What a collaborator may: read, and use the newsroom's panels. */
const COLLABORATOR_PARTS = [
  /^revisions$/,
  /^terms\/[\w-]+$/,
  /^plugin-extensions\/newsroom\/panel\/.+$/,
];

export async function submitterGate(
  context: APIContext,
  next: MiddlewareNext,
): Promise<Response> {
  const path = context.url.pathname.replace(/\/$/, "");
  if (!path.startsWith(API)) return next();
  const user = context.locals.user as User | null | undefined;
  // Nobody signed in: EmDash decides. Editors and up: no limits here.
  if (!user || user.role >= EDITOR) return next();

  const rest = path.slice(API.length);
  const method = context.request.method;
  const reading = method === "GET" || method === "HEAD";

  if (rest.startsWith("auth/")) return next();
  if (
    reading &&
    (rest === "manifest" ||
      rest === "taxonomies" ||
      /^taxonomies\/[\w-]+\/terms$/.test(rest) ||
      rest.startsWith("media/file/"))
  )
    return next();
  // `astro dev` asks for this on every schema change.
  if (import.meta.env.DEV && rest === "typegen") return next();
  if (
    method === "POST" &&
    /^plugins\/newsroom\/(threads|slack|admin)$/.test(rest)
  )
    return next();

  if (reading && /^revisions\/[^/]+$/.test(rest)) {
    const entry = await entryOfRevision(rest.split("/")[1]);
    return entry && (await levelOn(user.id, entry))
      ? next()
      : refuse("That revision is not of one of your articles.");
  }

  const content = /^content\/([\w-]+)(?:\/([^/]+)(?:\/(.+))?)?$/.exec(rest);
  if (!content)
    return refuse("Submitters cannot use this part of the newsroom.");
  const [, collection, id, part] = content;
  if (collection !== COLLECTION)
    return refuse("Submitters work on posts only.");

  if (!id) {
    if (method === "POST") return next();
    if (!reading) return refuse("Not allowed.");
    // The list: only what they wrote. (Articles shared with them are on the
    // newsroom's "Shared with me" page.)
    if (context.url.searchParams.get("authorId") === user.id) return next();
    // Asked for more than that: sent back to ask for their own. (The admin's
    // requests follow the redirect.)
    const narrowed = new URL(context.url);
    narrowed.searchParams.set("authorId", user.id);
    return context.redirect(`${narrowed.pathname}${narrowed.search}`, 307);
  }
  // Lists of every author, and of everyone's trash.
  if (id === "authors" || id === "trash")
    return refuse("Submitters see their own articles only.");

  const level = await levelOn(user.id, id);
  if (!level) return refuse("This is not one of your articles.");
  if (!part) {
    if (reading) return next();
    return level === "owner"
      ? next()
      : refuse("Only the article's author and editors can change it.");
  }
  const allowed = level === "owner" ? OWNER_PARTS : COLLABORATOR_PARTS;
  // A collaborator reads; anything that writes is the owner's.
  if (
    level === "collaborator" &&
    !reading &&
    !part.startsWith("plugin-extensions/")
  )
    return refuse("Only the article's author and editors can change it.");
  return allowed.some((pattern) => pattern.test(part))
    ? next()
    : refuse("Only editors can do that.");
}
