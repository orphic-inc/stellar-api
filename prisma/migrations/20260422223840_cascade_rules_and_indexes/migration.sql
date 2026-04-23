-- CreateEnum
CREATE TYPE "CommunityType" AS ENUM ('Music', 'Applications', 'EBooks', 'ELearningVideos', 'Audiobooks', 'Comedy', 'Comics');

-- CreateEnum
CREATE TYPE "FileType" AS ENUM ('txt', 'wav', 'pdf', 'wmv', 'ogg', 'lua', 'jpg', 'png');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('pending', 'accepted', 'rejected');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('open', 'invite', 'closed');

-- CreateEnum
CREATE TYPE "ReleaseType" AS ENUM ('Music', 'Applications', 'EBooks', 'ELearningVideos', 'Audiobooks', 'Comedy', 'Comics');

-- CreateEnum
CREATE TYPE "ReleaseCategory" AS ENUM ('Album', 'Single', 'EP', 'Anthology', 'Compilation', 'DJMix', 'Live', 'Remix', 'Bootleg', 'Interview', 'Mixtape', 'Demo', 'ConcertRecording', 'Unknown');

-- CreateEnum
CREATE TYPE "CommentPage" AS ENUM ('artist', 'collages', 'requests', 'communities');

-- CreateEnum
CREATE TYPE "SubscriptionPage" AS ENUM ('forums', 'artist', 'collages', 'requests', 'communities');

-- CreateEnum
CREATE TYPE "ThreadType" AS ENUM ('forum', 'application');

-- CreateEnum
CREATE TYPE "ApiUserState" AS ENUM ('inactive', 'active');

-- CreateEnum
CREATE TYPE "NoteVisibility" AS ENUM ('public', 'staff');

-- CreateTable
CREATE TABLE "user_ranks" (
    "id" SERIAL NOT NULL,
    "level" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "color" TEXT NOT NULL DEFAULT '',
    "badge" TEXT NOT NULL DEFAULT '',
    "uploadRequired" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "user_ranks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "id" SERIAL NOT NULL,
    "siteAppearance" TEXT NOT NULL DEFAULT 'cayer_make',
    "externalStylesheet" TEXT,
    "styledTooltips" BOOLEAN NOT NULL DEFAULT true,
    "paranoia" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "avatar" TEXT,
    "userRankId" INTEGER NOT NULL,
    "userSettingsId" INTEGER NOT NULL,
    "profileId" INTEGER NOT NULL,
    "inviteCount" INTEGER NOT NULL DEFAULT 0,
    "uploaded" INTEGER NOT NULL DEFAULT 0,
    "downloaded" INTEGER NOT NULL DEFAULT 0,
    "ratio" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "ratioWatchDownload" INTEGER,
    "lastLogin" TIMESTAMP(3),
    "dateRegistered" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "isArtist" BOOLEAN NOT NULL DEFAULT false,
    "isDonor" BOOLEAN NOT NULL DEFAULT false,
    "canDownload" BOOLEAN NOT NULL DEFAULT true,
    "adminComment" TEXT,
    "banDate" TIMESTAMP(3),
    "banReason" TEXT,
    "warned" TIMESTAMP(3),
    "warnedTimes" INTEGER NOT NULL DEFAULT 0,
    "communityPass" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invites" (
    "id" SERIAL NOT NULL,
    "inviterId" INTEGER NOT NULL,
    "inviteKey" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "status" "InviteStatus" NOT NULL DEFAULT 'pending',

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invite_trees" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "inviterId" INTEGER NOT NULL,
    "treePosition" INTEGER NOT NULL DEFAULT 1,
    "treeId" INTEGER NOT NULL DEFAULT 1,
    "treeLevel" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invite_trees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "friends" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "friendId" INTEGER NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "friends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" SERIAL NOT NULL,
    "avatar" TEXT,
    "avatarMouseoverText" TEXT,
    "profileTitle" TEXT,
    "profileInfo" TEXT,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stylesheets" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "cssUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stylesheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_categories" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "sort" INTEGER NOT NULL,

    CONSTRAINT "forum_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forums" (
    "id" SERIAL NOT NULL,
    "forumCategoryId" INTEGER NOT NULL,
    "sort" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "minClassRead" INTEGER NOT NULL DEFAULT 0,
    "minClassWrite" INTEGER NOT NULL DEFAULT 0,
    "minClassCreate" INTEGER NOT NULL DEFAULT 0,
    "numTopics" INTEGER NOT NULL DEFAULT 0,
    "numPosts" INTEGER NOT NULL DEFAULT 0,
    "autoLock" BOOLEAN NOT NULL DEFAULT true,
    "autoLockWeeks" INTEGER NOT NULL DEFAULT 4,
    "isTrash" BOOLEAN NOT NULL DEFAULT false,
    "lastTopicId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forums_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_topics" (
    "id" SERIAL NOT NULL,
    "forumId" INTEGER NOT NULL,
    "threadId" INTEGER,
    "title" TEXT NOT NULL,
    "authorId" INTEGER NOT NULL,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "isSticky" BOOLEAN NOT NULL DEFAULT false,
    "ranking" INTEGER NOT NULL DEFAULT 0,
    "numPosts" INTEGER NOT NULL DEFAULT 0,
    "lastPostId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forum_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_posts" (
    "id" SERIAL NOT NULL,
    "forumTopicId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "edits" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forum_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_polls" (
    "id" SERIAL NOT NULL,
    "forumTopicId" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "answers" TEXT NOT NULL,
    "featured" TIMESTAMP(3),
    "closed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "forum_polls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_poll_votes" (
    "id" SERIAL NOT NULL,
    "forumPollId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "vote" INTEGER NOT NULL,

    CONSTRAINT "forum_poll_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_last_read_topics" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "forumTopicId" INTEGER NOT NULL,
    "forumPostId" INTEGER NOT NULL,

    CONSTRAINT "forum_last_read_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_topic_notes" (
    "id" SERIAL NOT NULL,
    "forumTopicId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forum_topic_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_specific_rules" (
    "id" SERIAL NOT NULL,
    "forumId" INTEGER,
    "threadId" INTEGER,
    "forumTopicId" INTEGER,

    CONSTRAINT "forum_specific_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "threads" (
    "id" SERIAL NOT NULL,
    "type" "ThreadType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artists" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "vanityHouse" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "artists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artist_histories" (
    "id" SERIAL NOT NULL,
    "artistId" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "editedBy" INTEGER NOT NULL,
    "editedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,

    CONSTRAINT "artist_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artist_aliases" (
    "id" SERIAL NOT NULL,
    "artistId" INTEGER NOT NULL,
    "redirectId" INTEGER NOT NULL,
    "userId" INTEGER,

    CONSTRAINT "artist_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artist_tags" (
    "id" SERIAL NOT NULL,
    "artistId" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL,
    "positiveVotes" INTEGER NOT NULL DEFAULT 1,
    "negativeVotes" INTEGER NOT NULL DEFAULT 1,
    "userId" INTEGER,

    CONSTRAINT "artist_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concerts" (
    "id" SERIAL NOT NULL,
    "artistId" INTEGER NOT NULL,
    "forumTopicId" INTEGER NOT NULL,

    CONSTRAINT "concerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "similar_artists" (
    "id" SERIAL NOT NULL,
    "artistId" INTEGER NOT NULL,
    "similarArtistId" INTEGER NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "votes" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "similar_artists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communities" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "registrationStatus" "RegistrationStatus" NOT NULL,
    "type" "CommunityType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumers" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consumers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contributors" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "communityId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contributors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "releases" (
    "id" SERIAL NOT NULL,
    "artistId" INTEGER NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "image" TEXT,
    "description" VARCHAR(1000) NOT NULL,
    "communityId" INTEGER,
    "type" "ReleaseType" NOT NULL,
    "releaseType" "ReleaseCategory" NOT NULL,
    "year" INTEGER NOT NULL,
    "isEdition" BOOLEAN NOT NULL DEFAULT false,
    "edition" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contributions" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "releaseId" INTEGER NOT NULL,
    "contributorId" INTEGER NOT NULL,
    "releaseDescription" VARCHAR(1000),
    "sizeInBytes" INTEGER NOT NULL,
    "type" "FileType" NOT NULL,
    "jsonFile" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "do_not_upload" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "communityId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "do_not_upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" SERIAL NOT NULL,
    "page" "CommentPage" NOT NULL,
    "authorId" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "editedUserId" INTEGER,
    "editedAt" TIMESTAMP(3),
    "artistId" INTEGER,
    "communityId" INTEGER,
    "contributionId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_edits" (
    "id" SERIAL NOT NULL,
    "page" "SubscriptionPage",
    "postId" INTEGER,
    "editUserId" INTEGER,
    "editedAt" TIMESTAMP(3),
    "body" TEXT NOT NULL,

    CONSTRAINT "comment_edits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donations" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "email" TEXT NOT NULL,
    "donatedAt" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "source" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "addedBy" INTEGER NOT NULL DEFAULT 0,
    "totalRank" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "donations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bitcoin_donations" (
    "id" SERIAL NOT NULL,
    "bitcoinAddress" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "bitcoin_donations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donor_forum_usernames" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT '',
    "suffix" TEXT NOT NULL DEFAULT '',
    "useComma" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "donor_forum_usernames_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donor_rewards" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "iconMouseOverText" TEXT NOT NULL DEFAULT '',
    "avatarMouseOverText" TEXT NOT NULL DEFAULT '',
    "customIcon" TEXT NOT NULL DEFAULT '',
    "secondAvatar" TEXT NOT NULL DEFAULT '',
    "customIconLink" TEXT NOT NULL DEFAULT '',
    "profileInfo1" TEXT NOT NULL DEFAULT '',
    "profileInfo2" TEXT NOT NULL DEFAULT '',
    "profileInfo3" TEXT NOT NULL DEFAULT '',
    "profileInfo4" TEXT NOT NULL DEFAULT '',
    "profileInfoTitle1" TEXT NOT NULL DEFAULT '',
    "profileInfoTitle2" TEXT NOT NULL DEFAULT '',
    "profileInfoTitle3" TEXT NOT NULL DEFAULT '',
    "profileInfoTitle4" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "donor_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookmark_artists" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "artistId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookmark_artists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookmark_collages" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "collageId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookmark_collages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookmark_communities" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "releaseId" INTEGER NOT NULL,
    "communityId" INTEGER,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookmark_communities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookmark_requests" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "requestId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookmark_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blogs" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "threadId" INTEGER,
    "important" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_leaderboards" (
    "id" SERIAL NOT NULL,
    "contestId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "flacCount" INTEGER NOT NULL,
    "lastTorrentId" INTEGER NOT NULL,
    "lastTorrentName" TEXT NOT NULL,
    "artistList" TEXT NOT NULL,
    "artistNames" TEXT NOT NULL,
    "lastUpload" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contest_leaderboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_types" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "contest_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cover_art" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "image" TEXT NOT NULL DEFAULT '',
    "summary" TEXT,
    "userId" INTEGER NOT NULL DEFAULT 0,
    "addedAt" TIMESTAMP(3),

    CONSTRAINT "cover_art_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "featured_albums" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "threadId" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "started" TIMESTAMP(3) NOT NULL,
    "ended" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "featured_albums_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "featured_merch" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "image" TEXT NOT NULL DEFAULT '',
    "started" TIMESTAMP(3) NOT NULL,
    "ended" TIMESTAMP(3) NOT NULL,
    "artistId" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "featured_merch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "topicId" INTEGER NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_subscriptions" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "page" "SubscriptionPage" NOT NULL,
    "pageId" INTEGER NOT NULL,

    CONSTRAINT "comment_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "quoterId" INTEGER NOT NULL,
    "page" "SubscriptionPage" NOT NULL,
    "pageId" INTEGER NOT NULL,
    "postId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "occurrences" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tags" TEXT[],
    "comments" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applicants" (
    "id" SERIAL NOT NULL,
    "roleId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "threadId" INTEGER NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applicants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" SERIAL NOT NULL,
    "threadId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "visibility" "NoteVisibility" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_applications" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "name" VARCHAR(50) NOT NULL,

    CONSTRAINT "api_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_users" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "apiApplicationId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "state" "ApiUserState" NOT NULL,
    "access" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "userCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bad_passwords" (
    "id" SERIAL NOT NULL,
    "password" TEXT NOT NULL,

    CONSTRAINT "bad_passwords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currency_conversion_rates" (
    "id" SERIAL NOT NULL,
    "currency" TEXT NOT NULL,
    "rate" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "currency_conversion_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_blacklists" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL,
    "comment" TEXT NOT NULL,

    CONSTRAINT "email_blacklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ip_bans" (
    "id" SERIAL NOT NULL,
    "fromIp" INTEGER NOT NULL,
    "toIp" INTEGER NOT NULL,

    CONSTRAINT "ip_bans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_logs" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "communityId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL DEFAULT 0,
    "info" TEXT,
    "loggedAt" TIMESTAMP(3) NOT NULL,
    "hidden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "group_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "actorId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ContributionCollaborators" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "_CommunityConsumers" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "_CommunityStaff" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "_ReleaseConsumers" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "_ContributionConsumers" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "_ReleaseContributors" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "_ReleaseToTag" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_userSettingsId_key" ON "users"("userSettingsId");

-- CreateIndex
CREATE UNIQUE INDEX "users_profileId_key" ON "users"("profileId");

-- CreateIndex
CREATE INDEX "users_userRankId_idx" ON "users"("userRankId");

-- CreateIndex
CREATE UNIQUE INDEX "invites_inviteKey_key" ON "invites"("inviteKey");

-- CreateIndex
CREATE UNIQUE INDEX "invites_email_key" ON "invites"("email");

-- CreateIndex
CREATE INDEX "invites_status_idx" ON "invites"("status");

-- CreateIndex
CREATE UNIQUE INDEX "friends_userId_friendId_key" ON "friends"("userId", "friendId");

-- CreateIndex
CREATE UNIQUE INDEX "stylesheets_name_key" ON "stylesheets"("name");

-- CreateIndex
CREATE INDEX "forum_topics_forumId_idx" ON "forum_topics"("forumId");

-- CreateIndex
CREATE INDEX "forum_topics_authorId_idx" ON "forum_topics"("authorId");

-- CreateIndex
CREATE INDEX "forum_posts_forumTopicId_idx" ON "forum_posts"("forumTopicId");

-- CreateIndex
CREATE INDEX "forum_posts_authorId_idx" ON "forum_posts"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "forum_polls_forumTopicId_key" ON "forum_polls"("forumTopicId");

-- CreateIndex
CREATE UNIQUE INDEX "forum_poll_votes_forumPollId_userId_key" ON "forum_poll_votes"("forumPollId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "forum_last_read_topics_userId_forumTopicId_key" ON "forum_last_read_topics"("userId", "forumTopicId");

-- CreateIndex
CREATE INDEX "artist_tags_artistId_idx" ON "artist_tags"("artistId");

-- CreateIndex
CREATE UNIQUE INDEX "artist_tags_artistId_tagId_key" ON "artist_tags"("artistId", "tagId");

-- CreateIndex
CREATE UNIQUE INDEX "concerts_forumTopicId_key" ON "concerts"("forumTopicId");

-- CreateIndex
CREATE UNIQUE INDEX "similar_artists_artistId_similarArtistId_key" ON "similar_artists"("artistId", "similarArtistId");

-- CreateIndex
CREATE UNIQUE INDEX "communities_name_key" ON "communities"("name");

-- CreateIndex
CREATE UNIQUE INDEX "consumers_userId_key" ON "consumers"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "contributors_userId_key" ON "contributors"("userId");

-- CreateIndex
CREATE INDEX "releases_artistId_idx" ON "releases"("artistId");

-- CreateIndex
CREATE INDEX "releases_communityId_idx" ON "releases"("communityId");

-- CreateIndex
CREATE INDEX "contributions_userId_idx" ON "contributions"("userId");

-- CreateIndex
CREATE INDEX "contributions_releaseId_idx" ON "contributions"("releaseId");

-- CreateIndex
CREATE INDEX "contributions_contributorId_idx" ON "contributions"("contributorId");

-- CreateIndex
CREATE INDEX "comments_page_communityId_idx" ON "comments"("page", "communityId");

-- CreateIndex
CREATE INDEX "comments_page_contributionId_idx" ON "comments"("page", "contributionId");

-- CreateIndex
CREATE INDEX "comments_page_artistId_idx" ON "comments"("page", "artistId");

-- CreateIndex
CREATE INDEX "comment_edits_postId_idx" ON "comment_edits"("postId");

-- CreateIndex
CREATE INDEX "donations_userId_idx" ON "donations"("userId");

-- CreateIndex
CREATE INDEX "donations_donatedAt_idx" ON "donations"("donatedAt");

-- CreateIndex
CREATE INDEX "bitcoin_donations_bitcoinAddress_idx" ON "bitcoin_donations"("bitcoinAddress");

-- CreateIndex
CREATE UNIQUE INDEX "donor_forum_usernames_userId_key" ON "donor_forum_usernames"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "donor_rewards_userId_key" ON "donor_rewards"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "bookmark_artists_userId_artistId_key" ON "bookmark_artists"("userId", "artistId");

-- CreateIndex
CREATE UNIQUE INDEX "bookmark_collages_userId_collageId_key" ON "bookmark_collages"("userId", "collageId");

-- CreateIndex
CREATE UNIQUE INDEX "bookmark_communities_userId_releaseId_key" ON "bookmark_communities"("userId", "releaseId");

-- CreateIndex
CREATE UNIQUE INDEX "bookmark_requests_userId_requestId_key" ON "bookmark_requests"("userId", "requestId");

-- CreateIndex
CREATE INDEX "contest_leaderboards_flacCount_idx" ON "contest_leaderboards"("flacCount");

-- CreateIndex
CREATE INDEX "contest_leaderboards_lastUpload_idx" ON "contest_leaderboards"("lastUpload");

-- CreateIndex
CREATE INDEX "contest_leaderboards_userId_idx" ON "contest_leaderboards"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "contest_types_name_key" ON "contest_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "cover_art_groupId_image_key" ON "cover_art"("groupId", "image");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_userId_topicId_key" ON "subscriptions"("userId", "topicId");

-- CreateIndex
CREATE UNIQUE INDEX "comment_subscriptions_userId_page_pageId_key" ON "comment_subscriptions"("userId", "page", "pageId");

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_key" ON "tags"("name");

-- CreateIndex
CREATE UNIQUE INDEX "api_applications_token_key" ON "api_applications"("token");

-- CreateIndex
CREATE UNIQUE INDEX "api_users_token_key" ON "api_users"("token");

-- CreateIndex
CREATE UNIQUE INDEX "bad_passwords_password_key" ON "bad_passwords"("password");

-- CreateIndex
CREATE UNIQUE INDEX "currency_conversion_rates_currency_key" ON "currency_conversion_rates"("currency");

-- CreateIndex
CREATE INDEX "email_blacklists_email_idx" ON "email_blacklists"("email");

-- CreateIndex
CREATE UNIQUE INDEX "_ContributionCollaborators_AB_unique" ON "_ContributionCollaborators"("A", "B");

-- CreateIndex
CREATE INDEX "_ContributionCollaborators_B_index" ON "_ContributionCollaborators"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_CommunityConsumers_AB_unique" ON "_CommunityConsumers"("A", "B");

-- CreateIndex
CREATE INDEX "_CommunityConsumers_B_index" ON "_CommunityConsumers"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_CommunityStaff_AB_unique" ON "_CommunityStaff"("A", "B");

-- CreateIndex
CREATE INDEX "_CommunityStaff_B_index" ON "_CommunityStaff"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_ReleaseConsumers_AB_unique" ON "_ReleaseConsumers"("A", "B");

-- CreateIndex
CREATE INDEX "_ReleaseConsumers_B_index" ON "_ReleaseConsumers"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_ContributionConsumers_AB_unique" ON "_ContributionConsumers"("A", "B");

-- CreateIndex
CREATE INDEX "_ContributionConsumers_B_index" ON "_ContributionConsumers"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_ReleaseContributors_AB_unique" ON "_ReleaseContributors"("A", "B");

-- CreateIndex
CREATE INDEX "_ReleaseContributors_B_index" ON "_ReleaseContributors"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_ReleaseToTag_AB_unique" ON "_ReleaseToTag"("A", "B");

-- CreateIndex
CREATE INDEX "_ReleaseToTag_B_index" ON "_ReleaseToTag"("B");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_userRankId_fkey" FOREIGN KEY ("userRankId") REFERENCES "user_ranks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_userSettingsId_fkey" FOREIGN KEY ("userSettingsId") REFERENCES "user_settings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_trees" ADD CONSTRAINT "invite_trees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friends" ADD CONSTRAINT "friends_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friends" ADD CONSTRAINT "friends_friendId_fkey" FOREIGN KEY ("friendId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forums" ADD CONSTRAINT "forums_forumCategoryId_fkey" FOREIGN KEY ("forumCategoryId") REFERENCES "forum_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forums" ADD CONSTRAINT "forums_lastTopicId_fkey" FOREIGN KEY ("lastTopicId") REFERENCES "forum_topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_topics" ADD CONSTRAINT "forum_topics_forumId_fkey" FOREIGN KEY ("forumId") REFERENCES "forums"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_topics" ADD CONSTRAINT "forum_topics_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_topics" ADD CONSTRAINT "forum_topics_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_topics" ADD CONSTRAINT "forum_topics_lastPostId_fkey" FOREIGN KEY ("lastPostId") REFERENCES "forum_posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_forumTopicId_fkey" FOREIGN KEY ("forumTopicId") REFERENCES "forum_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_polls" ADD CONSTRAINT "forum_polls_forumTopicId_fkey" FOREIGN KEY ("forumTopicId") REFERENCES "forum_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_poll_votes" ADD CONSTRAINT "forum_poll_votes_forumPollId_fkey" FOREIGN KEY ("forumPollId") REFERENCES "forum_polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_last_read_topics" ADD CONSTRAINT "forum_last_read_topics_forumTopicId_fkey" FOREIGN KEY ("forumTopicId") REFERENCES "forum_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_last_read_topics" ADD CONSTRAINT "forum_last_read_topics_forumPostId_fkey" FOREIGN KEY ("forumPostId") REFERENCES "forum_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_topic_notes" ADD CONSTRAINT "forum_topic_notes_forumTopicId_fkey" FOREIGN KEY ("forumTopicId") REFERENCES "forum_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_topic_notes" ADD CONSTRAINT "forum_topic_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_specific_rules" ADD CONSTRAINT "forum_specific_rules_forumId_fkey" FOREIGN KEY ("forumId") REFERENCES "forums"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_specific_rules" ADD CONSTRAINT "forum_specific_rules_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_specific_rules" ADD CONSTRAINT "forum_specific_rules_forumTopicId_fkey" FOREIGN KEY ("forumTopicId") REFERENCES "forum_topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artist_histories" ADD CONSTRAINT "artist_histories_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "artists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artist_histories" ADD CONSTRAINT "artist_histories_editedBy_fkey" FOREIGN KEY ("editedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artist_aliases" ADD CONSTRAINT "artist_aliases_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "artists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artist_aliases" ADD CONSTRAINT "artist_aliases_redirectId_fkey" FOREIGN KEY ("redirectId") REFERENCES "artists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artist_tags" ADD CONSTRAINT "artist_tags_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "artists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artist_tags" ADD CONSTRAINT "artist_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concerts" ADD CONSTRAINT "concerts_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "artists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concerts" ADD CONSTRAINT "concerts_forumTopicId_fkey" FOREIGN KEY ("forumTopicId") REFERENCES "forum_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "similar_artists" ADD CONSTRAINT "similar_artists_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "artists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "similar_artists" ADD CONSTRAINT "similar_artists_similarArtistId_fkey" FOREIGN KEY ("similarArtistId") REFERENCES "artists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumers" ADD CONSTRAINT "consumers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributors" ADD CONSTRAINT "contributors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributors" ADD CONSTRAINT "contributors_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "releases" ADD CONSTRAINT "releases_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "artists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "releases" ADD CONSTRAINT "releases_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "contributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "do_not_upload" ADD CONSTRAINT "do_not_upload_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_editedUserId_fkey" FOREIGN KEY ("editedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "artists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "contributions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donor_forum_usernames" ADD CONSTRAINT "donor_forum_usernames_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donor_rewards" ADD CONSTRAINT "donor_rewards_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmark_artists" ADD CONSTRAINT "bookmark_artists_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmark_artists" ADD CONSTRAINT "bookmark_artists_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "artists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmark_collages" ADD CONSTRAINT "bookmark_collages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmark_communities" ADD CONSTRAINT "bookmark_communities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmark_communities" ADD CONSTRAINT "bookmark_communities_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmark_communities" ADD CONSTRAINT "bookmark_communities_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmark_requests" ADD CONSTRAINT "bookmark_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blogs" ADD CONSTRAINT "blogs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_subscriptions" ADD CONSTRAINT "comment_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_quoterId_fkey" FOREIGN KEY ("quoterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applicants" ADD CONSTRAINT "applicants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applicants" ADD CONSTRAINT "applicants_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_applications" ADD CONSTRAINT "api_applications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_users" ADD CONSTRAINT "api_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_users" ADD CONSTRAINT "api_users_apiApplicationId_fkey" FOREIGN KEY ("apiApplicationId") REFERENCES "api_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ContributionCollaborators" ADD CONSTRAINT "_ContributionCollaborators_A_fkey" FOREIGN KEY ("A") REFERENCES "artists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ContributionCollaborators" ADD CONSTRAINT "_ContributionCollaborators_B_fkey" FOREIGN KEY ("B") REFERENCES "contributions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CommunityConsumers" ADD CONSTRAINT "_CommunityConsumers_A_fkey" FOREIGN KEY ("A") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CommunityConsumers" ADD CONSTRAINT "_CommunityConsumers_B_fkey" FOREIGN KEY ("B") REFERENCES "consumers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CommunityStaff" ADD CONSTRAINT "_CommunityStaff_A_fkey" FOREIGN KEY ("A") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CommunityStaff" ADD CONSTRAINT "_CommunityStaff_B_fkey" FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ReleaseConsumers" ADD CONSTRAINT "_ReleaseConsumers_A_fkey" FOREIGN KEY ("A") REFERENCES "consumers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ReleaseConsumers" ADD CONSTRAINT "_ReleaseConsumers_B_fkey" FOREIGN KEY ("B") REFERENCES "releases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ContributionConsumers" ADD CONSTRAINT "_ContributionConsumers_A_fkey" FOREIGN KEY ("A") REFERENCES "consumers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ContributionConsumers" ADD CONSTRAINT "_ContributionConsumers_B_fkey" FOREIGN KEY ("B") REFERENCES "contributions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ReleaseContributors" ADD CONSTRAINT "_ReleaseContributors_A_fkey" FOREIGN KEY ("A") REFERENCES "contributors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ReleaseContributors" ADD CONSTRAINT "_ReleaseContributors_B_fkey" FOREIGN KEY ("B") REFERENCES "releases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ReleaseToTag" ADD CONSTRAINT "_ReleaseToTag_A_fkey" FOREIGN KEY ("A") REFERENCES "releases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ReleaseToTag" ADD CONSTRAINT "_ReleaseToTag_B_fkey" FOREIGN KEY ("B") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
