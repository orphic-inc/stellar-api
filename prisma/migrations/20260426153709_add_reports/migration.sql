-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('Open', 'Claimed', 'Resolved');

-- CreateEnum
CREATE TYPE "ReportTargetType" AS ENUM ('User', 'Release', 'Artist', 'ForumTopic', 'ForumPost', 'Comment', 'Collage', 'Post');

-- CreateEnum
CREATE TYPE "ReportResolutionAction" AS ENUM ('Dismissed', 'ContentRemoved', 'UserWarned', 'UserDisabled', 'MetadataFixed', 'Other');

-- CreateTable
CREATE TABLE "reports" (
    "id" SERIAL NOT NULL,
    "reporterId" INTEGER NOT NULL,
    "targetType" "ReportTargetType" NOT NULL,
    "targetId" INTEGER NOT NULL,
    "category" VARCHAR(50) NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'Open',
    "claimedById" INTEGER,
    "claimedAt" TIMESTAMP(3),
    "resolvedById" INTEGER,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "resolutionAction" "ReportResolutionAction",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_notes" (
    "id" SERIAL NOT NULL,
    "reportId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reports_status_idx" ON "reports"("status");

-- CreateIndex
CREATE INDEX "reports_targetType_targetId_idx" ON "reports"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "reports_reporterId_idx" ON "reports"("reporterId");

-- CreateIndex
CREATE INDEX "reports_claimedById_idx" ON "reports"("claimedById");

-- CreateIndex
CREATE INDEX "report_notes_reportId_idx" ON "report_notes"("reportId");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_notes" ADD CONSTRAINT "report_notes_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_notes" ADD CONSTRAINT "report_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
