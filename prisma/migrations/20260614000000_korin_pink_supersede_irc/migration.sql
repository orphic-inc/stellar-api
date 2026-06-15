-- ADR-0013: korin.pink external IRC supersedes the in-repo IRC build.
-- Reverses the in-repo IRC schema (ADR-0011 per-user keys, ADR-0012 activity
-- rollup) and adds the external nick mapping. communityPass stays dropped (#134).

-- Drop the in-repo IRC activity rollup substrate (ADR-0012, added in 20260613000001).
DROP TABLE "irc_activity";

-- Drop the in-repo per-user IRC/Announce credentials (ADR-0011, added in 20260613000000).
DROP INDEX "users_ircKey_key";
DROP INDEX "users_announceKey_key";
ALTER TABLE "users" DROP COLUMN "ircKey",
DROP COLUMN "announceKey";

-- Add the external IRC nick mapping (korin.pink).
ALTER TABLE "users" ADD COLUMN "ircNick" TEXT;
CREATE UNIQUE INDEX "users_ircNick_key" ON "users"("ircNick");
