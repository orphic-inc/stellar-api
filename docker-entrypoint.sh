#!/bin/sh
# Apply pending migrations before the API serves a single request, then hand off
# to the app. Fail-fast: if `migrate deploy` errors, the container exits non-zero
# (restart: always retries) rather than serving against a schema-behind database
# — the exact break that a merged-but-unapplied migration otherwise causes.
set -e

echo "[entrypoint] Applying database migrations (prisma migrate deploy)..."
npx prisma migrate deploy

echo "[entrypoint] Migrations up to date. Starting API..."
exec node dist/index.js
