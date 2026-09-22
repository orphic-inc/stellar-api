-- The paranoia level never gated anything (#586, ADR-0046). Every visibility
-- decision reads the five show* booleans, which the cascade on PUT /profile/me
-- kept in step. NO BACKFILL: a stored level that disagrees with those booleans
-- was never in effect, so applying it now would retroactively change what other
-- members can see of someone.
ALTER TABLE "user_settings" DROP COLUMN "paranoia";
