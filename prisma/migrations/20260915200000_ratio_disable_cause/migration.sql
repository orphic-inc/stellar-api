-- CreateEnum
CREATE TYPE "RatioDisableCause" AS ENUM ('RATIO', 'STAFF');

-- AlterTable
ALTER TABLE "ratio_policy_states" ADD COLUMN     "disabledCause" "RatioDisableCause";
