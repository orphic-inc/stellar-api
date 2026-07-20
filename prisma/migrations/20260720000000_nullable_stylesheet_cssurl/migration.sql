-- ADR-0024 §3/§4 (#371): a registry row may have NO delivery target.
-- null `cssUrl` = appears in the picker, renders nothing.
ALTER TABLE "stylesheets" ALTER COLUMN "cssUrl" DROP NOT NULL;

-- Null every row still pointing into stellar-ui's retired `/stylesheets/…`
-- static tree. Such a value is a delivery target that cannot resolve — the drift
-- #371 exists to end — so the row degrades to "renders nothing" (still
-- selectable) instead of shipping a dangling <link>.
--
-- Sublime is the row this is really for: its look IS the bundled Tailwind, so
-- there was never anything to inject, and the '/stylesheets/sublime/style.css'
-- it carried was requested by nothing. It keeps `isDefault` and its picker entry.
-- The 2026-05-24 seed migration also planted `kuro` here; `seedStylesheetFixtures`
-- reconciles that one to a real /css target on the next seed.
--
-- Scoped by path rather than by name so an operator who has since pointed a row
-- at a real delivery target keeps it. After this, modules/stylesheetRegistry.ts
-- holds the invariant and the registry guard fails CI on any row that reappears
-- outside the partition.
UPDATE "stylesheets"
SET "cssUrl" = NULL
WHERE "cssUrl" LIKE '/stylesheets/%';
