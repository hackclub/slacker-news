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

# A new volume gets the content model and the articles migrated from the MDX
# files. An existing database is left alone, so editors' changes survive a
# redeploy. Set EMDASH_SEED=always to apply the seed on every start; entries
# that already exist are skipped.
if [ ! -f "$DB" ] || [ "${EMDASH_SEED:-}" = "always" ]; then
  echo "Applying seed/seed.json to $DB"
  node node_modules/emdash/dist/cli/index.mjs seed seed/seed.json --database "$DB" --uploads-dir "$DATA_DIR/uploads"
fi

exec "$@"
