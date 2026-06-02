-- Add description and isDefault columns to stylesheets
ALTER TABLE "stylesheets" ADD COLUMN "description" TEXT NOT NULL DEFAULT '';
ALTER TABLE "stylesheets" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- Backfill stale siteAppearance default: cayer_make -> sublime
UPDATE "user_settings"
SET "siteAppearance" = 'sublime'
WHERE "siteAppearance" = 'cayer_make';

-- Seed built-in stylesheets
INSERT INTO "stylesheets" ("name", "description", "cssUrl", "isDefault", "createdAt")
VALUES
  ('sublime', 'Default Stellar theme',       '/stylesheets/sublime/style.css', true,  NOW()),
  ('kuro',    'Gazelle-inspired dark theme', '/stylesheets/kuro/style.css',    false, NOW())
ON CONFLICT ("name") DO UPDATE SET
  "description" = EXCLUDED."description",
  "cssUrl"      = EXCLUDED."cssUrl",
  "isDefault"   = EXCLUDED."isDefault";

-- Normalise: ensure only sublime is default before adding the unique constraint
UPDATE "stylesheets"
SET "isDefault" = false
WHERE "isDefault" = true AND "name" <> 'sublime';

-- DB-level single-default invariant (partial unique index)
-- Prisma DSL does not support partial unique indexes; this is managed via raw SQL migration only.
CREATE UNIQUE INDEX "stylesheets_one_default"
  ON "stylesheets"("isDefault")
  WHERE "isDefault" = true;
