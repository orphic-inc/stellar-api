-- #396: AssetKind gains `Avatar`, so a member can self-host an avatar in the
-- content-addressed store (ADR-0026) instead of hotlinking a host they control.
--
-- WRITTEN BY HAND, for the reason 20260830230000 records: Prisma renders an enum
-- change as a drop-and-recreate of the type, which cannot work while `assets.kind`
-- depends on it. ADD VALUE is additive — no row is rewritten and no existing value
-- moves, so every stored ThemeImage/ThemeFont row is untouched.
--
-- ALTER TYPE ... ADD VALUE inside a transaction requires Postgres 12+; CI runs 16
-- and compose runs 18.6. The new value is added and not USED in this migration,
-- which is the restriction that rule actually carries.
--
-- The original CREATE TYPE in 20260719000000_add_asset_store is deliberately left
-- alone: migrations are immutable history, and editing one changes its checksum.

ALTER TYPE "AssetKind" ADD VALUE 'Avatar';
