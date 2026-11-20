#!/bin/sh
# Prepares the EmDash data volume, then starts the server.
set -eu

DATA_DIR=/app/data
DB="$DATA_DIR/emdash.db"
mkdir -p "$DATA_DIR/uploads"

if [ -z "${EMDASH_ENCRYPTION_KEY:-}" ]; then
  echo "EMDASH_ENCRYPTION_KEY is not set. Generate one with: npx emdash secrets generate" >&2
  exit 1
fi

EMDASH="node node_modules/emdash/dist/cli/index.mjs"

if [ ! -f "$DB" ]; then
  # A new volume gets the content model and the articles migrated from the
  # MDX files.
  echo "Creating $DB from seed/seed.json"
  $EMDASH seed seed/seed.json --database "$DB" --uploads-dir "$DATA_DIR/uploads"
  node scripts/emdash-migrate.mjs "$DB"
else
  # An existing database keeps its content, so editors' changes survive a
  # redeploy. Only the content model is brought in step with this build, which
  # is how a field added in scripts/build-emdash-seed.ts reaches a live site.
  echo "Updating the content model in $DB"
  # First, the changes the seed cannot make, such as a field changing type.
  node scripts/emdash-migrate.mjs "$DB"
  # model.json is seed.json without the content and the site settings, so a
  # title an editor changed in Settings is not put back.
  $EMDASH seed seed/model.json --database "$DB" --no-content --on-conflict update
fi

# Content moved into the CMS from the repository, imported once. After that
# the CMS is where it lives.
node scripts/emdash-import-once.mjs "$DB" seed/short-changelogs.json short-changelogs
# Bylines for the people the site credits, and for articles that have none.
node scripts/emdash-after-seed.mjs "$DB"

exec "$@"
