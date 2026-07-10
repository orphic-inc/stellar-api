#!/bin/sh
# Migrate, then seed the idempotent baseline, then hand off to the app — so a
# fresh deploy comes up ready for /install instead of an empty database. Fail-fast
# (`set -e`): if migrate or seed errors, the container exits non-zero (restart:
# always retries) rather than serving against a schema-behind or unseeded database
# — the exact break that a merged-but-unapplied migration otherwise causes.
set -e

echo "[entrypoint] Applying database migrations (prisma migrate deploy)..."
npx prisma migrate deploy

# Idempotent: a no-op on an already-seeded database, so it's safe on every boot.
echo "[entrypoint] Seeding baseline data (ranks, forums, rules, fixtures)..."
node dist/scripts/seed.js

echo "[entrypoint] Ready. Starting API..."
exec node dist/index.js
