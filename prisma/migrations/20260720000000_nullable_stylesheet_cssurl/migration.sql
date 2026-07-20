-- ADR-0024 §3/§4 (#371): a registry row may have NO delivery target.
-- null `cssUrl` = appears in the picker, renders nothing.
ALTER TABLE "stylesheets" ALTER COLUMN "cssUrl" DROP NOT NULL;

-- Sublime only. Its look IS the bundled Tailwind, so there was never anything to
-- inject, and the path it carried was requested by nothing.
--
-- Scoped to that exact dead path, NOT to `LIKE '/stylesheets/%'`. The broad form
-- also matches `postmod`, which ADR-0024's drift table records as "Live; gated on
-- #343" — stellar-ui still serves it and it is not a seeded fixture, so nulling it
-- would silently unstyle every user who selected it, ahead of the migration that
-- is supposed to move it. The other legacy rows (`kuro`, `layer-cake`, `anorex`,
-- `dark-ambient`, `proton`) are fixtures: `seedStylesheetFixtures` reconciles each
-- to its `/css` target on the next seed, so they need no data migration here.
--
-- Conditioned on the value so an operator who has already repointed Sublime at a
-- real delivery target keeps it.
UPDATE "stylesheets"
SET "cssUrl" = NULL
WHERE "name" = 'sublime'
  AND "cssUrl" = '/stylesheets/sublime/style.css';
