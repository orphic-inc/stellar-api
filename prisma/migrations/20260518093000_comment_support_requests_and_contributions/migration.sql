ALTER TYPE "CommentPage" RENAME VALUE 'requests' TO 'contributions';
ALTER TYPE "CommentPage" ADD VALUE 'requests';

ALTER TABLE "comments"
ADD COLUMN "requestId" INTEGER;

ALTER TABLE "comments"
ADD CONSTRAINT "comments_requestId_fkey"
FOREIGN KEY ("requestId") REFERENCES "requests"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

CREATE INDEX "comments_page_requestId_idx" ON "comments"("page", "requestId");
