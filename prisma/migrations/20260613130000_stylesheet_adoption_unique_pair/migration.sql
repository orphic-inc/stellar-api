-- Make the once-per-(adopter, author) stylesheet-adoption dedup atomic.
--
-- The CRS_STYLESHEET_ADOPTION ledger row records the durable (author = userId,
-- adopter = actorUserId) pair exactly once. Without a DB constraint, two
-- concurrent adopts (a double-click) both pass the application-level existence
-- check and both insert, double-crediting the author on read (breaks the
-- ADR-0007 "durable once-per-pair" guarantee). A partial unique index makes the
-- dedup atomic so the second insert raises P2002 and is swallowed as "already
-- scored".
--
-- This is a partial unique index, which Prisma cannot model in schema.prisma,
-- so it is created with raw SQL here. Expect a benign drift warning on the next
-- `prisma migrate dev` — accepted trade-off.
CREATE UNIQUE INDEX "economy_transactions_stylesheet_adoption_pair_key"
  ON "economy_transactions" ("userId", "actorUserId")
  WHERE "reason" = 'CRS_STYLESHEET_ADOPTION';
