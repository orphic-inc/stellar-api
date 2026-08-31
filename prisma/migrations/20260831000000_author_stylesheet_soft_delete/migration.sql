-- #368 / ADR-0032 §3: soft delete for AuthorStylesheet.
--
-- Additive and nullable, so existing rows are untouched and read as live.
-- The column exists because withdrawal has to do two things that pull apart:
-- free the author's registry space (a quota the rank gate enforces with no way
-- to release, #146) without changing the site under someone who adopted the
-- sheet. A hard delete cannot do the second — UserSettings.activeAuthorStylesheetId
-- points at this row.

ALTER TABLE "author_stylesheets" ADD COLUMN "deletedAt" TIMESTAMP(3);
