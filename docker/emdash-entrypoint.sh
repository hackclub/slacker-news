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
else
  # An existing database keeps its content, so editors' changes survive a
  # redeploy. Only the content model is brought in step with this build, which
  # is how a field added in scripts/build-emdash-seed.ts reaches a live site.
  echo "Updating the content model in $DB"
  # Changes the seed cannot make on its own, such as a field changing type.
  node scripts/emdash-migrate.mjs "$DB"
  $EMDASH seed seed/seed.json --database "$DB" --no-content --on-conflict update
fi

exec "$@"
