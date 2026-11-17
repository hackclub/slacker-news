#!/usr/bin/env node
/**
 * Brings an existing database in step with what the seed now describes, for
 * the changes the seed cannot make itself.
 *
 *   node scripts/emdash-after-seed.mjs [database] [acknowledgements.json]
 *
 * People: every person in src/data/acknowledgements.json becomes a byline with two
 * fields, their Slack ID and their roles. Every article that names an author in
 * its old `author` text gets that person as a credited byline, which is what
 * the editor's Bylines section shows and edits. The container runs this on
 * every start, after the seed, so it only fills in what is missing: a byline
 * or credit an editor has changed is left alone.
 *
 * Fields that went away: a post's category is now a taxonomy term (so the
 * category it had becomes its term), the front page preview is merged into
 * the summary (`excerpt`), and the expiry date is dropped. The body field no
 * longer uses the old comment editor.
 *
 * Plain Node, like emdash-migrate.mjs, because the container has no Bun.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const [dbPath = "data/emdash.db", peoplePath] = process.argv.slice(2);
const db = new DatabaseSync(dbPath);
// Wait, rather than fail, if the server has the database busy.
db.exec("pragma busy_timeout = 10000");
// All or nothing, so a stop halfway leaves nothing half-filled.
db.exec("begin immediate");

const peopleFile = [
  peoplePath,
  "seed/acknowledgements.json",
  "src/data/acknowledgements.json",
].find((path) => path && existsSync(path));
const people = peopleFile ? JSON.parse(readFileSync(peopleFile, "utf8")) : [];

const SLACK_ID = /^<?@?([UW][A-Z0-9]{6,})(?:\|[^>]*)?>?$/;

/** The same spelling rules the site uses to match an author to a person. */
function handleOf(name) {
  return name
    .trim()
    .replace(/^@+/, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim()
    .toLowerCase();
}

/** "@eps and @zrl" names two people. Spaces alone never separate them. */
function splitAuthors(author) {
  return author
    .split(/\s+and\s+|\s*[,&]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function slugify(text) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "person"
  );
}

let fieldsChanged = false;

function ensureField(slug, label, sortOrder) {
  const found = db
    .prepare("select id from _emdash_byline_fields where slug = ?")
    .get(slug);
  if (found) return found.id;
  fieldsChanged = true;
  const id = randomUUID();
  db.prepare(
    `insert into _emdash_byline_fields
       (id, slug, label, type, required, translatable, sort_order)
     values (?, ?, ?, 'string', 0, 1, ?)`,
  ).run(id, slug, label, sortOrder);
  return id;
}

const slackField = ensureField("slack_id", "Slack ID", 0);
const rolesField = ensureField("roles", "Roles", 1);
if (fieldsChanged) {
  // EmDash caches the field list under this counter; even means settled, so
  // it moves by two.
  db.prepare(
    `update options set value = cast(cast(value as integer) + 2 as text)
      where name = 'byline_fields_version'`,
  ).run();
}

// EmDash stores a byline field's value as JSON, so text is kept quoted.
db.exec(
  `update _emdash_byline_field_values set value = json_quote(value)
    where value is not null and json_valid(value) = 0`,
);

function setValue(bylineId, fieldId, value) {
  if (!value) return;
  db.prepare(
    `insert or ignore into _emdash_byline_field_values
       (byline_id, field_id, value) values (?, ?, ?)`,
  ).run(bylineId, fieldId, JSON.stringify(value));
}

// What exists now, by Slack ID and by handle.
const bySlackId = new Map();
const byHandle = new Map();
const slugs = new Set();

function remember(row) {
  slugs.add(row.slug);
  byHandle.set(handleOf(row.display_name), row.id);
  byHandle.set(row.slug, row.id);
  if (row.slack_id) bySlackId.set(row.slack_id, row.id);
}

for (const row of db
  .prepare(
    `select b.id, b.slug, b.display_name, v.value as slack_id
       from _emdash_bylines b
       left join _emdash_byline_field_values v
         on v.byline_id = b.id and v.field_id = ?`,
  )
  .all(slackField)) {
  remember({
    ...row,
    slack_id: row.slack_id ? JSON.parse(row.slack_id) : null,
  });
}

function createByline({ displayName, slackId, roles }) {
  let slug = slugify(displayName);
  for (let n = 2; slugs.has(slug); n += 1) {
    slug = `${slugify(displayName)}-${n}`;
  }
  const id = randomUUID();
  db.prepare(
    `insert into _emdash_bylines
       (id, slug, display_name, is_guest, locale, translation_group)
     values (?, ?, ?, 1, 'en', ?)`,
  ).run(id, slug, displayName, id);
  setValue(id, slackField, slackId);
  setValue(id, rolesField, roles);
  remember({
    id,
    slug,
    display_name: displayName,
    slack_id: slackId ?? null,
  });
  return id;
}

let createdPeople = 0;
for (const person of people) {
  const name = person.name.trim().replace(/^@+/, "");
  const known =
    (person.slackId && bySlackId.get(person.slackId)) ||
    byHandle.get(handleOf(person.name));
  if (known) {
    // Someone credited before the acknowledgements were moved: fill in what
    // is missing without touching what is there.
    setValue(known, slackField, person.slackId);
    setValue(known, rolesField, (person.roles ?? []).join(","));
    continue;
  }
  createByline({
    displayName: name,
    slackId: person.slackId,
    roles: (person.roles ?? []).join(","),
  });
  createdPeople += 1;
}

/** The byline for one name in an old `author` text, made if it is new. */
function bylineFor(name) {
  const slackId = name.trim().match(SLACK_ID)?.[1];
  if (slackId) {
    return (
      bySlackId.get(slackId) ??
      createByline({ displayName: slackId, slackId, roles: "" })
    );
  }
  return (
    byHandle.get(handleOf(name)) ??
    createByline({
      displayName: name.trim().replace(/^@+/, ""),
      roles: "",
    })
  );
}

let credited = 0;
for (const collection of ["posts", "changelogs", "pages"]) {
  const table = `ec_${collection}`;
  const columns = db
    .prepare(`pragma table_info("${table}")`)
    .all()
    .map((column) => column.name);
  if (!columns.includes("author")) continue;
  const hasPrimary = columns.includes("primary_byline_id");

  const rows = db
    .prepare(
      `select id, author from "${table}"
        where author is not null and author != ''
          and not exists (
            select 1 from _emdash_content_bylines c
             where c.collection_slug = ? and c.content_id = "${table}".id)`,
    )
    .all(collection);

  for (const row of rows) {
    const ids = [
      ...new Set(
        splitAuthors(String(row.author)).map((name) => bylineFor(name)),
      ),
    ];
    ids.forEach((bylineId, order) => {
      db.prepare(
        `insert or ignore into _emdash_content_bylines
           (id, collection_slug, content_id, byline_id, sort_order)
         values (?, ?, ?, ?, ?)`,
      ).run(randomUUID(), collection, row.id, bylineId, order);
    });
    if (hasPrimary && ids[0]) {
      db.prepare(
        `update "${table}" set primary_byline_id = ? where id = ?`,
      ).run(ids[0], row.id);
    }
    credited += 1;
  }
}

/** Does the table still have this column? */
function hasColumn(table, column) {
  return db
    .prepare(`pragma table_info("${table}")`)
    .all()
    .some((row) => row.name === column);
}

/** Forgets a field: its definition, and its column in the collection's table. */
function dropField(collection, slug) {
  const table = `ec_${collection}`;
  if (!hasColumn(table, slug)) return;
  try {
    db.exec(`alter table "${table}" drop column "${slug}"`);
  } catch (error) {
    console.warn(`Could not remove ${collection}.${slug}: ${error.message}`);
    return;
  }
  db.prepare(
    `delete from _emdash_fields where slug = ? and collection_id in
       (select id from _emdash_collections where slug = ?)`,
  ).run(slug, collection);
  console.log(`Removed the ${slug} field of ${collection}.`);
}

// Category: the old select field becomes a term of the category taxonomy.
if (hasColumn("ec_posts", "category")) {
  const terms = new Map(
    db
      .prepare("select slug, id from taxonomies where name = 'category'")
      .all()
      .map((row) => [row.slug, row.id]),
  );
  const posts = db.prepare("select id, category from ec_posts").all();
  // The seed leaves terms out of an existing database, so make the ones the
  // posts use.
  for (const slug of new Set(posts.map((post) => post.category))) {
    if (!slug || terms.has(slug)) continue;
    const id = randomUUID();
    db.prepare(
      `insert into taxonomies (id, name, slug, label, locale, translation_group)
       values (?, 'category', ?, ?, 'en', ?)`,
    ).run(id, slug, slug[0].toUpperCase() + slug.slice(1), id);
    terms.set(slug, id);
  }
  let unplaced = 0;
  for (const post of posts) {
    const term = terms.get(post.category);
    if (!term) {
      unplaced += 1;
      continue;
    }
    db.prepare(
      `insert or ignore into content_taxonomies (collection, entry_id, taxonomy_id)
       values ('posts', ?, ?)`,
    ).run(post.id, term);
  }
  // Only forget the old field once every post has a term to stand in for it.
  if (unplaced === 0) dropField("posts", "category");
  else console.warn(`${unplaced} posts have no matching category term.`);
}

// Summary: a hand-picked front page preview was the more specific text, so it
// becomes the summary, whose paragraphs the front page shows.
if (hasColumn("ec_posts", "front_page_preview")) {
  db.exec(
    `update ec_posts set excerpt = front_page_preview
      where front_page_preview is not null and front_page_preview != ''`,
  );
  dropField("posts", "front_page_preview");
}

dropField("posts", "expires_at");

// The body's own comment and suggestion editor is gone (comments live in the
// rich-text editor now), so the body is a plain text box again.
db.exec(
  `update _emdash_fields set widget = null where widget = 'newsroom:review-text'`,
);

db.exec("commit");

if (createdPeople || credited) {
  console.log(
    `People: ${createdPeople} bylines added from the acknowledgements, ${credited} articles credited.`,
  );
}
