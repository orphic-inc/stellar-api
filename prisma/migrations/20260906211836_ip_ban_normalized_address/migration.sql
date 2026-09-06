-- IpBan bounds move from two signed 32-bit Ints to the full 128-bit address as
-- 32 lowercase hex characters, IPv4 mapped into ::ffff:0:0/96 (#540).
--
-- The Int columns could not do the job. `parseIpv4ToInt` ended in `| 0`, so every
-- address from 128.0.0.0 up was stored negative: a range CROSSING that boundary
-- (100.0.0.0 to 200.0.0.0) stored from=1677721600 and to=-939524096, and no SQL
-- `from <= c AND to >= c` can be satisfied by those. The route's validator
-- accepted such ranges, so staff could create a ban that silently matched
-- nothing. IPv6 was unrepresentable entirely, though nginx listens on [::]:80.
--
-- Prisma's generated migration for this type change carried no USING clause,
-- which would have cast each Int to its DECIMAL STRING ('-2147483648') and
-- quietly turned every existing ban into an unmatchable value. The conversion is
-- therefore explicit:
--
--   * `::bigint & 4294967295` recovers the unsigned 32-bit value from the signed
--     one -- this is the step that repairs the 128.0.0.0-and-up rows.
--   * `to_hex` + `lpad` renders it as the low 8 hex characters.
--   * the constant prefix is ::ffff:0:0/96, so IPv4 sorts as one contiguous
--     block and lexicographic order equals numeric order.

ALTER TABLE "ip_bans"
  ALTER COLUMN "fromIp" SET DATA TYPE CHAR(32)
    USING '00000000000000000000ffff' ||
          lpad(to_hex("fromIp"::bigint & 4294967295), 8, '0'),
  ALTER COLUMN "toIp" SET DATA TYPE CHAR(32)
    USING '00000000000000000000ffff' ||
          lpad(to_hex("toIp"::bigint & 4294967295), 8, '0');

-- Serves range containment for both address families, because the width is fixed.
CREATE INDEX "ip_bans_fromIp_toIp_idx" ON "ip_bans"("fromIp", "toIp");
