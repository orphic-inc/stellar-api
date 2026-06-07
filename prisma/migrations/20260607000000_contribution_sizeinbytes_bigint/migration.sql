-- File sizes in bytes overflow INT4 (max 2,147,483,647 ≈ 2.0 GiB).
-- Widen contributions.sizeInBytes to BIGINT to match approvedAccountingBytes.
ALTER TABLE "contributions" ALTER COLUMN "sizeInBytes" SET DATA TYPE BIGINT;
