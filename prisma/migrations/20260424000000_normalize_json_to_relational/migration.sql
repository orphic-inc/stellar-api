-- CreateTable: post_comments
CREATE TABLE "post_comments" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable: forum_post_edits
CREATE TABLE "forum_post_edits" (
    "id" SERIAL NOT NULL,
    "forumPostId" INTEGER NOT NULL,
    "editorId" INTEGER NOT NULL,
    "previousBody" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forum_post_edits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "post_comments_postId_idx" ON "post_comments"("postId");

-- CreateIndex
CREATE INDEX "forum_post_edits_forumPostId_idx" ON "forum_post_edits"("forumPostId");

-- AddForeignKey
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_post_edits" ADD CONSTRAINT "forum_post_edits_forumPostId_fkey" FOREIGN KEY ("forumPostId") REFERENCES "forum_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_post_edits" ADD CONSTRAINT "forum_post_edits_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DataMigration: move post comments from JSON to relational table
INSERT INTO "post_comments" ("postId", "userId", "text", "createdAt")
SELECT
    p.id,
    (c->>'userId')::int,
    c->>'text',
    COALESCE((c->>'date')::timestamptz, NOW())
FROM posts p,
     jsonb_array_elements(
         CASE WHEN p.comments::text = '[]' OR p.comments IS NULL
              THEN '[]'::jsonb
              ELSE p.comments::jsonb
         END
     ) AS c
WHERE (c->>'userId') IS NOT NULL AND (c->>'userId') <> '';

-- DataMigration: move forum post edits from JSON to relational table
INSERT INTO "forum_post_edits" ("forumPostId", "editorId", "previousBody", "editedAt")
SELECT
    fp.id,
    (e->>'userId')::int,
    e->>'previousBody',
    COALESCE((e->>'time')::timestamptz, NOW())
FROM forum_posts fp,
     jsonb_array_elements(
         CASE WHEN fp.edits::text = '[]' OR fp.edits IS NULL
              THEN '[]'::jsonb
              ELSE fp.edits::jsonb
         END
     ) AS e
WHERE (e->>'userId') IS NOT NULL AND (e->>'userId') <> '';

-- DropColumn: posts.comments (JSON)
ALTER TABLE "posts" DROP COLUMN "comments";

-- DropColumn: forum_posts.edits (JSON)
ALTER TABLE "forum_posts" DROP COLUMN "edits";
