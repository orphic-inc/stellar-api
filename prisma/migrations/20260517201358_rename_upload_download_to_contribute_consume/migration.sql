/*
  Warnings:

  - You are about to drop the column `downloadedAtWatchStart` on the `ratio_policy_states` table. All the data in the column will be lost.
  - You are about to drop the column `showDownloadedStats` on the `user_settings` table. All the data in the column will be lost.
  - You are about to drop the column `showUploadedStats` on the `user_settings` table. All the data in the column will be lost.
  - You are about to drop the column `downloaded` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `uploaded` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ratio_policy_states" DROP COLUMN "downloadedAtWatchStart",
ADD COLUMN     "consumedAtWatchStart" BIGINT;

-- AlterTable
ALTER TABLE "user_settings" DROP COLUMN "showDownloadedStats",
DROP COLUMN "showUploadedStats",
ADD COLUMN     "showConsumedStats" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showContributedStats" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "downloaded",
DROP COLUMN "uploaded",
ADD COLUMN     "consumed" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "contributed" BIGINT NOT NULL DEFAULT 0;
