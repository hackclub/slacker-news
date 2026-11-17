#!/usr/bin/env node
/**
 * Changes to an existing EmDash database that applying the seed cannot make.
 *
 *   node scripts/emdash-migrate.mjs [database]
 *
 * The container runs this on every start, before it brings the content model
 * in step with the build. Each step checks whether it still has work to do, so running it again
 * is harmless. It is plain Node so it can run in the container, which has no
 * Bun.
 */
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(process.argv[2] ?? "data/emdash.db");

/**
 * `date` was a text field holding "2026-06-23" or "2026-06-23 10:57:00". It is
 * now a datetime, so the admin can show and sort by it. EmDash refuses to
 * change a field's type itself, because the stored values have to change too.
 */
function dateFieldsToDatetime() {
  const fields = db
    .prepare(
      `select f.id, c.slug as collection from _emdash_fields f
       join _emdash_collections c on c.id = f.collection_id
       where f.slug = 'date' and f.type = 'string'`,
    )
    .all();

  // Both old forms, read as UTC. Anything else is left for a person to fix.
  const asInstant = (column) => `case
    when ${column} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' then ${column} || 'T00:00:00.000Z'
    when ${column} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
      then replace(${column}, ' ', 'T') || '.000Z'
    else ${column} end`;

  for (const { id, collection } of fields) {
    db.exec("begin");
    db.exec(`update "ec_${collection}" set date = ${asInstant("date")}`);
    // Revisions keep their own copy of an entry's fields.
    db.prepare(
      `update revisions
       set data = json_set(data, '$.date', ${asInstant("json_extract(data, '$.date')")})
       where collection = ? and json_extract(data, '$.date') is not null`,
    ).run(collection);
    db.prepare(
      "update _emdash_fields set type = 'datetime', options = null where id = ?",
    ).run(id);
    db.exec("commit");
    console.log(`${collection}: date is now a datetime`);
  }
}

/**
 * Migrated articles were all "published" at the moment they were imported,
 * which is where EmDash's calendar put them. Their publish time becomes the
 * article's date. This runs once: entries published in the CMS afterwards keep
 * the time they were really published.
 */
function publishedAtFromDate() {
  const marker = "slacker-news:published-at-from-date";
  if (db.prepare("select 1 from options where name = ?").get(marker)) return;

  for (const collection of ["posts", "changelogs"]) {
    const { changes } = db
      .prepare(
        `update "ec_${collection}" set published_at = date
         where status = 'published' and date glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'`,
      )
      .run();
    console.log(
      `${collection}: publish time taken from the date of ${changes} entries`,
    );
  }
  db.prepare("insert into options (name, value) values (?, 'true')").run(
    marker,
  );
}

dateFieldsToDatetime();
publishedAtFromDate();
db.close();
