-- #509 F3: soft delete for Artist.
--
-- Additive and nullable, so existing rows are untouched and read as live —
-- the same shape as 20260831000000_author_stylesheet_soft_delete.
--
-- `DELETE /api/artists/:id` called `prisma.artist.delete()`, and every artist
-- relation that matters is `ON DELETE RESTRICT`: artist_histories, release
-- credits, tags, aliases, comments, bookmarks, subscriptions and the two
-- similar-artist sides. `createArtist` writes an artist_histories row at
-- creation, so an artist made through the API has a restricting child from
-- birth and the hard delete could only ever raise a foreign-key error the
-- global handler renders as a 500.
--
-- So the column is not merely a policy preference: it is the only way this
-- route can succeed at all without either cascading away an artist's edit
-- history and credits, or refusing every artist that has ever been touched.

ALTER TABLE "artists" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Every artist list, search and count filters on this, so index it the way
-- author_stylesheets is not but the larger soft-deleted tables are.
CREATE INDEX "artists_deletedAt_idx" ON "artists"("deletedAt");
