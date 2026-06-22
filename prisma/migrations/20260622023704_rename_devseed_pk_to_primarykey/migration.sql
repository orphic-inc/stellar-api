-- Rename `pk` -> `primaryKey` on dev-seed tracking tables. The literal column
-- name `pk` collides with mermaid's reserved PK attribute keyword, breaking the
-- generated docs/erd.md render on GitHub. RENAME (not DROP/ADD) preserves data.

-- AlterTable
ALTER TABLE "dev_seed_records" RENAME COLUMN "pk" TO "primaryKey";

-- AlterTable
ALTER TABLE "dev_seed_mutations" RENAME COLUMN "pk" TO "primaryKey";
