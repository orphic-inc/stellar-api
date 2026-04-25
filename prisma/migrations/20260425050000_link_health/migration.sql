-- CreateEnum
CREATE TYPE "LinkHealthStatus" AS ENUM ('UNKNOWN', 'PASS', 'WARN', 'FAIL');

-- AlterTable: add link health columns to contributions
ALTER TABLE "contributions"
  ADD COLUMN "linkStatus"    "LinkHealthStatus" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "linkCheckedAt" TIMESTAMP(3);

-- CreateTable: contribution reports
CREATE TABLE "contribution_reports" (
    "id"             SERIAL NOT NULL,
    "contributionId" INTEGER NOT NULL,
    "reporterId"     INTEGER NOT NULL,
    "reason"         TEXT NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contribution_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contribution_reports_contributionId_idx" ON "contribution_reports"("contributionId");

-- AddForeignKey
ALTER TABLE "contribution_reports"
  ADD CONSTRAINT "contribution_reports_contributionId_fkey"
  FOREIGN KEY ("contributionId") REFERENCES "contributions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution_reports"
  ADD CONSTRAINT "contribution_reports_reporterId_fkey"
  FOREIGN KEY ("reporterId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
