import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execSync } from "node:child_process";

test("build emits valid RSS feed", () => {
  execSync("npm run build", { stdio: "pipe" });

  const body = fs.readFileSync("dist/feed.xml", "utf8");

  assert.match(body, /<rss/i);
  assert.match(body, /<channel>/i);
  assert.match(body, /<title>Slacker News<\/title>/i);
  assert.match(body, /<item>/i);
});
