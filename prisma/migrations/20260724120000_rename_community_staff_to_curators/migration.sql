-- ADR-0033: Community.staff → Community.curators.
--
-- "Staff" is reserved site-wide for the Axis-2 rank capability
-- (rankPermissions.ts); this is an Axis-1 per-community role relation, and the
-- two met in the same code path often enough to cost design work.
--
-- WRITTEN BY HAND, DELIBERATELY. Prisma regenerates an implicit M:N table by
-- dropping and recreating it, which would silently discard every existing
-- curator row — including the flagship community's, seeded by
-- seedDefaultCommunity. Losing them would be survivable pre-alpha (that seed is
-- idempotent) but discarding a relation by default is not a thing to do.
--
-- ALTER TABLE ... RENAME does not carry constraints or indexes with it, so each
-- is renamed explicitly to the name Prisma derives from the new relation name.
-- Renaming a constraint also renames its backing index, which is why the PK
-- needs no separate ALTER INDEX.

ALTER TABLE "_CommunityStaff" RENAME TO "_CommunityCurators";

ALTER TABLE "_CommunityCurators" RENAME CONSTRAINT "_CommunityStaff_AB_pkey" TO "_CommunityCurators_AB_pkey";
ALTER TABLE "_CommunityCurators" RENAME CONSTRAINT "_CommunityStaff_A_fkey" TO "_CommunityCurators_A_fkey";
ALTER TABLE "_CommunityCurators" RENAME CONSTRAINT "_CommunityStaff_B_fkey" TO "_CommunityCurators_B_fkey";

ALTER INDEX "_CommunityStaff_B_index" RENAME TO "_CommunityCurators_B_index";
