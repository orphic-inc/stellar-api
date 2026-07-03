-- Register the built-in 'anorex' theme (#255) — a wood-toned theme with
-- brown/cream accents, authored on the --st-* token contract (ADR-0005) and
-- served by stellar-ui at /stylesheets/anorex/style.css. Idempotent upsert,
-- matching the pattern in 20260524200000_add_legacy_stylesheets.
INSERT INTO "stylesheets" ("name", "description", "cssUrl", "isDefault", "createdAt")
VALUES
  ('anorex', 'Classic wood-toned theme — brown/cream', '/stylesheets/anorex/style.css', false, NOW())
ON CONFLICT ("name") DO UPDATE SET
  "description" = EXCLUDED."description",
  "cssUrl"      = EXCLUDED."cssUrl";
