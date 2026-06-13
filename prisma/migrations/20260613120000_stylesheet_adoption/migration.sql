-- AlterEnum
ALTER TYPE "EconomyTransactionReason" ADD VALUE 'CRS_STYLESHEET_ADOPTION';

-- DropIndex: AuthorStylesheet is now many-per-author (PRD-03 #119)
DROP INDEX "author_stylesheets_authorId_key";

-- CreateIndex
CREATE INDEX "author_stylesheets_authorId_idx" ON "author_stylesheets"("authorId");

-- AlterTable: a member's adopted Site Stylesheet slot
ALTER TABLE "user_settings" ADD COLUMN "activeAuthorStylesheetId" INTEGER;

-- CreateIndex
CREATE INDEX "user_settings_activeAuthorStylesheetId_idx" ON "user_settings"("activeAuthorStylesheetId");

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_activeAuthorStylesheetId_fkey" FOREIGN KEY ("activeAuthorStylesheetId") REFERENCES "author_stylesheets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
