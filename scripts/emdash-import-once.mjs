#!/usr/bin/env node
/**
 * Applies a seed file to a database once, and never again.
 *
 *   node scripts/emdash-import-once.mjs <database> <seed.json> <name>
 *
 * For content moved into the CMS from the repository, such as the one-line
 * changelog entries: after the first import the CMS holds it, so an entry an
 * editor deletes must not come back on the next start. The import is
 * remembered in EmDash's options table under `slacker-news:imported:<name>`.
 *
 * Plain Node, like the other scripts the container runs.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const [dbPath, seedPath, name] = process.argv.slice(2);
if (!dbPath || !seedPath || !name) {
  console.error("Usage: emdash-import-once.mjs <database> <seed.json> <name>");
  process.exit(2);
}
if (!existsSync(seedPath)) {
  console.warn(`${seedPath} is missing; nothing imported.`);
  process.exit(0);
}

const key = `slacker-news:imported:${name}`;
const db = new DatabaseSync(dbPath);
db.exec("pragma busy_timeout = 10000");
const done = db.prepare("select 1 from options where name = ?").get(key);
if (done) process.exit(0);

console.log(`Importing ${seedPath} once`);
const cli = existsSync("node_modules/emdash/dist/cli/index.mjs")
  ? "node_modules/emdash/dist/cli/index.mjs"
  : undefined;
if (!cli) throw new Error("The EmDash CLI is not installed.");
// Entries that already exist are skipped.
execFileSync(
  process.execPath,
  [cli, "seed", seedPath, "--database", dbPath, "--on-conflict", "skip"],
  { stdio: "inherit" },
);
db.prepare("insert or replace into options (name, value) values (?, ?)").run(
  key,
  JSON.stringify(new Date().toISOString()),
);
