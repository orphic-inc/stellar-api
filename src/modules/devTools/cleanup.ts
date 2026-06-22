/**
 * devTools/cleanup.ts
 *
 * Two-stage cleanup:
 *   Stage 1: Delete seed-owned rows in reverse dependency order.
 *   Stage 2: Revert tracked shared mutations (integrated mode).
 *
 * Cleanup is idempotent — if a row is already gone (cascade-deleted), skip it.
 * Failures per entity are collected rather than aborting the whole operation.
 */

import { PrismaClient } from '@prisma/client';
import { CleanupResult } from './types';
import { getTrackedRecords, getTrackedMutations } from './tracking';

type DeleteResult = { count: number };

/**
 * Safely attempt a prisma deleteMany and return the count.
 * Swallows errors so one failure doesn't stop the rest of cleanup.
 */
async function safeDeleteMany(
  fn: () => Promise<DeleteResult>,
  label: string,
  failedItems: CleanupResult['failedItems']
): Promise<number> {
  try {
    const result = await fn();
    return result.count;
  } catch (err) {
    failedItems.push({
      entityType: label,
      pk: {},
      error: err instanceof Error ? err.message : String(err)
    });
    return 0;
  }
}

export async function cleanupRun(
  prisma: PrismaClient,
  runId: string
): Promise<CleanupResult> {
  const deletedCounts: Record<string, number> = {};
  const failedItems: CleanupResult['failedItems'] = [];
  const warnings: string[] = [];

  // Mark run as cleaning
  await prisma.devSeedRun.update({
    where: { id: runId },
    data: { cleanupStatus: 'cleaning', updatedAt: new Date() }
  });

  // Get all tracked records
  const records = await getTrackedRecords(prisma, runId);

  // Helper to get Int IDs for an entityType
  const getIds = (entityType: string): number[] => {
    const pks = records.get(entityType) ?? [];
    return pks
      .map((pk) => (pk as Record<string, number>).id)
      .filter((id) => typeof id === 'number');
  };

  // ─── Stage 1: Delete in reverse dependency order ──────────────────────────

  // 1. Votes, bookmarks, subscriptions, lastRead — leaf nodes
  deletedCounts['ReleaseTagVote'] = await safeDeleteMany(
    () =>
      prisma.releaseTagVote.deleteMany({
        where: { id: { in: getIds('ReleaseTagVote') } }
      }),
    'ReleaseTagVote',
    failedItems
  );
  deletedCounts['RequestVote'] = await safeDeleteMany(
    () =>
      prisma.requestVote.deleteMany({
        where: { id: { in: getIds('RequestVote') } }
      }),
    'RequestVote',
    failedItems
  );
  deletedCounts['ForumPollVote'] = await safeDeleteMany(
    () =>
      prisma.forumPollVote.deleteMany({
        where: { id: { in: getIds('ForumPollVote') } }
      }),
    'ForumPollVote',
    failedItems
  );
  deletedCounts['CollageSubscription'] = await safeDeleteMany(
    () =>
      prisma.collageSubscription.deleteMany({
        where: {
          OR: [
            { collageId: { in: getIds('Collage') } },
            { userId: { in: getIds('User') } }
          ]
        }
      }),
    'CollageSubscription',
    failedItems
  );
  deletedCounts['BookmarkRelease'] = await safeDeleteMany(
    () =>
      prisma.bookmarkRelease.deleteMany({
        where: { userId: { in: getIds('User') } }
      }),
    'BookmarkRelease',
    failedItems
  );
  deletedCounts['BookmarkCollage'] = await safeDeleteMany(
    () =>
      prisma.bookmarkCollage.deleteMany({
        where: { userId: { in: getIds('User') } }
      }),
    'BookmarkCollage',
    failedItems
  );
  deletedCounts['BookmarkRequest'] = await safeDeleteMany(
    () =>
      prisma.bookmarkRequest.deleteMany({
        where: { userId: { in: getIds('User') } }
      }),
    'BookmarkRequest',
    failedItems
  );
  deletedCounts['BookmarkArtist'] = await safeDeleteMany(
    () =>
      prisma.bookmarkArtist.deleteMany({
        where: { userId: { in: getIds('User') } }
      }),
    'BookmarkArtist',
    failedItems
  );
  deletedCounts['BookmarkCommunity'] = await safeDeleteMany(
    () =>
      prisma.bookmarkCommunity.deleteMany({
        where: { userId: { in: getIds('User') } }
      }),
    'BookmarkCommunity',
    failedItems
  );
  deletedCounts['ArtistSubscription'] = await safeDeleteMany(
    () =>
      prisma.artistSubscription.deleteMany({
        where: { userId: { in: getIds('User') } }
      }),
    'ArtistSubscription',
    failedItems
  );
  // ForumLastReadTopic — by generated user OR by generated topic (integrated mode)
  deletedCounts['ForumLastReadTopic'] = await safeDeleteMany(
    () =>
      prisma.forumLastReadTopic.deleteMany({
        where: {
          OR: [
            { userId: { in: getIds('User') } },
            { forumTopicId: { in: getIds('ForumTopic') } }
          ]
        }
      }),
    'ForumLastReadTopic',
    failedItems
  );
  // Subscriptions
  deletedCounts['Subscription'] = await safeDeleteMany(
    () =>
      prisma.subscription.deleteMany({
        where: { userId: { in: getIds('User') } }
      }),
    'Subscription',
    failedItems
  );
  deletedCounts['CommentSubscription'] = await safeDeleteMany(
    () =>
      prisma.commentSubscription.deleteMany({
        where: { userId: { in: getIds('User') } }
      }),
    'CommentSubscription',
    failedItems
  );
  // Notifications
  deletedCounts['Notification'] = await safeDeleteMany(
    () =>
      prisma.notification.deleteMany({
        where: { userId: { in: getIds('User') } }
      }),
    'Notification',
    failedItems
  );

  // 2. Comments, post edits, wiki revisions
  deletedCounts['Comment'] = await safeDeleteMany(
    () =>
      prisma.comment.deleteMany({ where: { id: { in: getIds('Comment') } } }),
    'Comment',
    failedItems
  );
  deletedCounts['ForumPostEdit'] = await safeDeleteMany(
    () =>
      prisma.forumPostEdit.deleteMany({
        where: { id: { in: getIds('ForumPostEdit') } }
      }),
    'ForumPostEdit',
    failedItems
  );
  deletedCounts['WikiRevision'] = await safeDeleteMany(
    () =>
      prisma.wikiRevision.deleteMany({
        where: { id: { in: getIds('WikiRevision') } }
      }),
    'WikiRevision',
    failedItems
  );
  deletedCounts['ForumTopicNote'] = await safeDeleteMany(
    () =>
      prisma.forumTopicNote.deleteMany({
        where: { id: { in: getIds('ForumTopicNote') } }
      }),
    'ForumTopicNote',
    failedItems
  );
  deletedCounts['ReportNote'] = await safeDeleteMany(
    () =>
      prisma.reportNote.deleteMany({
        where: { id: { in: getIds('ReportNote') } }
      }),
    'ReportNote',
    failedItems
  );
  deletedCounts['StaffInboxMessage'] = await safeDeleteMany(
    () =>
      prisma.staffInboxMessage.deleteMany({
        where: { id: { in: getIds('StaffInboxMessage') } }
      }),
    'StaffInboxMessage',
    failedItems
  );
  deletedCounts['PrivateMessage'] = await safeDeleteMany(
    () =>
      prisma.privateMessage.deleteMany({
        where: { id: { in: getIds('PrivateMessage') } }
      }),
    'PrivateMessage',
    failedItems
  );
  deletedCounts['PostComment'] = await safeDeleteMany(
    () =>
      prisma.postComment.deleteMany({
        where: { userId: { in: getIds('User') } }
      }),
    'PostComment',
    failedItems
  );

  // 3. Forum posts, polls
  deletedCounts['ForumPoll'] = await safeDeleteMany(
    () =>
      prisma.forumPoll.deleteMany({
        where: { id: { in: getIds('ForumPoll') } }
      }),
    'ForumPoll',
    failedItems
  );
  deletedCounts['ForumPost'] = await safeDeleteMany(
    () =>
      prisma.forumPost.deleteMany({
        where: { id: { in: getIds('ForumPost') } }
      }),
    'ForumPost',
    failedItems
  );

  // 4. Forum topics
  deletedCounts['ForumTopic'] = await safeDeleteMany(
    () =>
      prisma.forumTopic.deleteMany({
        where: { id: { in: getIds('ForumTopic') } }
      }),
    'ForumTopic',
    failedItems
  );

  // 5. Collage entries, request sub-records
  deletedCounts['CollageEntry'] = await safeDeleteMany(
    () =>
      prisma.collageEntry.deleteMany({
        where: { collageId: { in: getIds('Collage') } }
      }),
    'CollageEntry',
    failedItems
  );
  deletedCounts['RequestBounty'] = await safeDeleteMany(
    () =>
      prisma.requestBounty.deleteMany({
        where: { id: { in: getIds('RequestBounty') } }
      }),
    'RequestBounty',
    failedItems
  );
  deletedCounts['RequestFill'] = await safeDeleteMany(
    () =>
      prisma.requestFill.deleteMany({
        where: { id: { in: getIds('RequestFill') } }
      }),
    'RequestFill',
    failedItems
  );
  deletedCounts['RequestAction'] = await safeDeleteMany(
    () =>
      prisma.requestAction.deleteMany({
        where: { id: { in: getIds('RequestAction') } }
      }),
    'RequestAction',
    failedItems
  );
  deletedCounts['RequestArtist'] = await safeDeleteMany(
    () =>
      prisma.requestArtist.deleteMany({
        where: { id: { in: getIds('RequestArtist') } }
      }),
    'RequestArtist',
    failedItems
  );

  // 6. Collages, requests
  deletedCounts['Collage'] = await safeDeleteMany(
    () =>
      prisma.collage.deleteMany({ where: { id: { in: getIds('Collage') } } }),
    'Collage',
    failedItems
  );
  deletedCounts['Request'] = await safeDeleteMany(
    () =>
      prisma.request.deleteMany({ where: { id: { in: getIds('Request') } } }),
    'Request',
    failedItems
  );

  // 7. Contributions, download grants
  //
  // DownloadAccessGrant has FKs to Consumer, Contributor, and Contribution.
  // Deleting by tracked IDs alone can miss grants whose trackCreate call was
  // swallowed by an outer try/catch in the generator. Use a belt-and-suspenders
  // OR filter so any grant connected to a generated user or contribution is
  // caught even if it was never individually tracked.
  deletedCounts['DownloadAccessGrant'] = await safeDeleteMany(
    () => {
      const orConditions: object[] = [];
      const grantIds = getIds('DownloadAccessGrant');
      const contribIds = getIds('Contribution');
      const userIds = getIds('User');
      if (grantIds.length > 0) orConditions.push({ id: { in: grantIds } });
      if (contribIds.length > 0)
        orConditions.push({ contributionId: { in: contribIds } });
      if (userIds.length > 0) {
        orConditions.push({ consumerId: { in: userIds } });
        orConditions.push({ contributorId: { in: userIds } });
      }
      if (orConditions.length === 0) return Promise.resolve({ count: 0 });
      return prisma.downloadAccessGrant.deleteMany({
        where: { OR: orConditions }
      });
    },
    'DownloadAccessGrant',
    failedItems
  );
  deletedCounts['ContributionReport'] = await safeDeleteMany(
    () =>
      prisma.contributionReport.deleteMany({
        where: { contributionId: { in: getIds('Contribution') } }
      }),
    'ContributionReport',
    failedItems
  );
  deletedCounts['Contribution'] = await safeDeleteMany(
    () =>
      prisma.contribution.deleteMany({
        where: { id: { in: getIds('Contribution') } }
      }),
    'Contribution',
    failedItems
  );

  // 8. Release tag votes, release tags, release history
  deletedCounts['ReleaseTagVote_release'] = await safeDeleteMany(
    () =>
      prisma.releaseTagVote.deleteMany({
        where: { releaseTag: { releaseId: { in: getIds('Release') } } }
      }),
    'ReleaseTagVote_release',
    failedItems
  );
  deletedCounts['ReleaseTag'] = await safeDeleteMany(
    () =>
      prisma.releaseTag.deleteMany({
        where: { releaseId: { in: getIds('Release') } }
      }),
    'ReleaseTag',
    failedItems
  );
  deletedCounts['ReleaseHistory'] = await safeDeleteMany(
    () =>
      prisma.releaseHistory.deleteMany({
        where: { id: { in: getIds('ReleaseHistory') } }
      }),
    'ReleaseHistory',
    failedItems
  );
  deletedCounts['ReleaseVote'] = await safeDeleteMany(
    () =>
      prisma.releaseVote.deleteMany({
        where: { id: { in: getIds('ReleaseVote') } }
      }),
    'ReleaseVote',
    failedItems
  );
  deletedCounts['ReleaseVoteAggregate'] = await safeDeleteMany(
    () =>
      prisma.releaseVoteAggregate.deleteMany({
        where: { id: { in: getIds('ReleaseVoteAggregate') } }
      }),
    'ReleaseVoteAggregate',
    failedItems
  );

  // 8b. ReleaseArtist credits + Editions (music remodel #72).
  //     Both have non-cascading FKs to Release; ReleaseArtist also references
  //     Artist; Edition is referenced by Contribution (deleted in step 7).
  //     Delete by relation (not tracked IDs) so credits/editions are caught
  //     even if the generator never tracked them individually.
  deletedCounts['ReleaseArtist'] = await safeDeleteMany(
    () =>
      prisma.releaseArtist.deleteMany({
        where: {
          OR: [
            { releaseId: { in: getIds('Release') } },
            { artistId: { in: getIds('Artist') } }
          ]
        }
      }),
    'ReleaseArtist',
    failedItems
  );
  deletedCounts['Edition'] = await safeDeleteMany(
    () =>
      prisma.edition.deleteMany({
        where: { releaseId: { in: getIds('Release') } }
      }),
    'Edition',
    failedItems
  );

  // 9. Releases
  deletedCounts['Release'] = await safeDeleteMany(
    () =>
      prisma.release.deleteMany({ where: { id: { in: getIds('Release') } } }),
    'Release',
    failedItems
  );

  // 10. Artist sub-records, then artists
  deletedCounts['ArtistTag'] = await safeDeleteMany(
    () =>
      prisma.artistTag.deleteMany({
        where: { artistId: { in: getIds('Artist') } }
      }),
    'ArtistTag',
    failedItems
  );
  deletedCounts['SimilarArtist'] = await safeDeleteMany(
    () =>
      prisma.similarArtist.deleteMany({
        where: { id: { in: getIds('SimilarArtist') } }
      }),
    'SimilarArtist',
    failedItems
  );
  deletedCounts['ArtistAlias'] = await safeDeleteMany(
    () =>
      prisma.artistAlias.deleteMany({
        where: { id: { in: getIds('ArtistAlias') } }
      }),
    'ArtistAlias',
    failedItems
  );
  deletedCounts['ArtistHistory'] = await safeDeleteMany(
    () =>
      prisma.artistHistory.deleteMany({
        where: { id: { in: getIds('ArtistHistory') } }
      }),
    'ArtistHistory',
    failedItems
  );
  deletedCounts['Artist'] = await safeDeleteMany(
    () => prisma.artist.deleteMany({ where: { id: { in: getIds('Artist') } } }),
    'Artist',
    failedItems
  );

  // 11. Wiki aliases, pages
  // WikiAlias has string PK
  const wikiAliasPks = (records.get('WikiAlias') ?? []) as Array<{
    alias: string;
  }>;
  if (wikiAliasPks.length > 0) {
    deletedCounts['WikiAlias'] = await safeDeleteMany(
      () =>
        prisma.wikiAlias.deleteMany({
          where: { alias: { in: wikiAliasPks.map((p) => p.alias) } }
        }),
      'WikiAlias',
      failedItems
    );
  }
  deletedCounts['WikiPage'] = await safeDeleteMany(
    () =>
      prisma.wikiPage.deleteMany({ where: { id: { in: getIds('WikiPage') } } }),
    'WikiPage',
    failedItems
  );

  // 12. Reports
  deletedCounts['Report'] = await safeDeleteMany(
    () => prisma.report.deleteMany({ where: { id: { in: getIds('Report') } } }),
    'Report',
    failedItems
  );

  // 13. Staff inbox
  deletedCounts['StaffInboxConversation'] = await safeDeleteMany(
    () =>
      prisma.staffInboxConversation.deleteMany({
        where: { id: { in: getIds('StaffInboxConversation') } }
      }),
    'StaffInboxConversation',
    failedItems
  );
  deletedCounts['StaffInboxResponse'] = await safeDeleteMany(
    () =>
      prisma.staffInboxResponse.deleteMany({
        where: { id: { in: getIds('StaffInboxResponse') } }
      }),
    'StaffInboxResponse',
    failedItems
  );

  // 14. Private messages & conversations
  // PrivateConversationParticipant has composite PK
  const participantPks = (records.get('PrivateConversationParticipant') ??
    []) as Array<{
    userId: number;
    conversationId: number;
  }>;
  for (const pk of participantPks) {
    try {
      await prisma.privateConversationParticipant.delete({
        where: {
          userId_conversationId: {
            userId: pk.userId,
            conversationId: pk.conversationId
          }
        }
      });
    } catch {
      // Already deleted
    }
  }
  deletedCounts['PrivateConversation'] = await safeDeleteMany(
    () =>
      prisma.privateConversation.deleteMany({
        where: { id: { in: getIds('PrivateConversation') } }
      }),
    'PrivateConversation',
    failedItems
  );

  // 15. Stat snapshots
  deletedCounts['UserStatSnapshot'] = await safeDeleteMany(
    () =>
      prisma.userStatSnapshot.deleteMany({
        where: { id: { in: getIds('UserStatSnapshot') } }
      }),
    'UserStatSnapshot',
    failedItems
  );
  deletedCounts['SiteStatSnapshot'] = await safeDeleteMany(
    () =>
      prisma.siteStatSnapshot.deleteMany({
        where: { id: { in: getIds('SiteStatSnapshot') } }
      }),
    'SiteStatSnapshot',
    failedItems
  );
  deletedCounts['Top10SnapshotEntry'] = await safeDeleteMany(
    () =>
      prisma.top10SnapshotEntry.deleteMany({
        where: { id: { in: getIds('Top10SnapshotEntry') } }
      }),
    'Top10SnapshotEntry',
    failedItems
  );
  deletedCounts['Top10Snapshot'] = await safeDeleteMany(
    () =>
      prisma.top10Snapshot.deleteMany({
        where: { id: { in: getIds('Top10Snapshot') } }
      }),
    'Top10Snapshot',
    failedItems
  );

  // 16. News, blog, notices, site history
  deletedCounts['News'] = await safeDeleteMany(
    () => prisma.news.deleteMany({ where: { id: { in: getIds('News') } } }),
    'News',
    failedItems
  );
  deletedCounts['Post'] = await safeDeleteMany(
    () => prisma.post.deleteMany({ where: { id: { in: getIds('Post') } } }),
    'Post',
    failedItems
  );
  deletedCounts['GlobalNotice'] = await safeDeleteMany(
    () =>
      prisma.globalNotice.deleteMany({
        where: { id: { in: getIds('GlobalNotice') } }
      }),
    'GlobalNotice',
    failedItems
  );
  deletedCounts['SiteHistory'] = await safeDeleteMany(
    () =>
      prisma.siteHistory.deleteMany({
        where: { id: { in: getIds('SiteHistory') } }
      }),
    'SiteHistory',
    failedItems
  );
  deletedCounts['MassMessage'] = await safeDeleteMany(
    () =>
      prisma.massMessage.deleteMany({
        where: { id: { in: getIds('MassMessage') } }
      }),
    'MassMessage',
    failedItems
  );

  // 17. User moderation
  deletedCounts['UserModerationNote'] = await safeDeleteMany(
    () =>
      prisma.userModerationNote.deleteMany({
        where: { id: { in: getIds('UserModerationNote') } }
      }),
    'UserModerationNote',
    failedItems
  );
  deletedCounts['UserWarning'] = await safeDeleteMany(
    () =>
      prisma.userWarning.deleteMany({
        where: { id: { in: getIds('UserWarning') } }
      }),
    'UserWarning',
    failedItems
  );

  // 18. Secondary ranks, donor ranks
  // UserSecondaryRank has composite PK
  const secondaryRankPks = (records.get('UserSecondaryRank') ?? []) as Array<{
    userId: number;
    userRankId: number;
  }>;
  for (const pk of secondaryRankPks) {
    try {
      await prisma.userSecondaryRank.delete({
        where: {
          userId_userRankId: { userId: pk.userId, userRankId: pk.userRankId }
        }
      });
    } catch {
      // Already deleted
    }
  }

  deletedCounts['UserDonorRank'] = await safeDeleteMany(
    () =>
      prisma.userDonorRank.deleteMany({
        where: { id: { in: getIds('UserDonorRank') } }
      }),
    'UserDonorRank',
    failedItems
  );
  deletedCounts['Donation'] = await safeDeleteMany(
    () =>
      prisma.donation.deleteMany({ where: { id: { in: getIds('Donation') } } }),
    'Donation',
    failedItems
  );

  // 19. Economy transactions
  deletedCounts['EconomyTransaction'] = await safeDeleteMany(
    () =>
      prisma.economyTransaction.deleteMany({
        where: { id: { in: getIds('EconomyTransaction') } }
      }),
    'EconomyTransaction',
    failedItems
  );

  // 20. Invites, invite tree
  deletedCounts['Invite'] = await safeDeleteMany(
    () => prisma.invite.deleteMany({ where: { id: { in: getIds('Invite') } } }),
    'Invite',
    failedItems
  );
  deletedCounts['InviteTree'] = await safeDeleteMany(
    () =>
      prisma.inviteTree.deleteMany({
        where: { userId: { in: getIds('User') } }
      }),
    'InviteTree',
    failedItems
  );

  // 21. Consumer / Contributor records (linked to users)
  deletedCounts['Consumer'] = await safeDeleteMany(
    () =>
      prisma.consumer.deleteMany({ where: { userId: { in: getIds('User') } } }),
    'Consumer',
    failedItems
  );
  deletedCounts['Contributor'] = await safeDeleteMany(
    () =>
      prisma.contributor.deleteMany({
        where: { userId: { in: getIds('User') } }
      }),
    'Contributor',
    failedItems
  );

  // 22. DoNotContribute + Community
  //     DoNotContribute references Community (no cascade) — must come first.
  //     Community can only be deleted after Release (step 9), Contributor (step 21),
  //     Request (step 6), and any direct child rows are gone.
  deletedCounts['DoNotContribute'] = await safeDeleteMany(
    () =>
      prisma.doNotContribute.deleteMany({
        where: { id: { in: getIds('DoNotContribute') } }
      }),
    'DoNotContribute',
    failedItems
  );
  deletedCounts['Community'] = await safeDeleteMany(
    () =>
      prisma.community.deleteMany({
        where: { id: { in: getIds('Community') } }
      }),
    'Community',
    failedItems
  );

  // 23. Tags (isolated mode — only seed.* tags)
  if (getIds('Tag').length > 0) {
    deletedCounts['Tag'] = await safeDeleteMany(
      () =>
        prisma.tag.deleteMany({
          where: {
            id: { in: getIds('Tag') },
            name: { startsWith: 'seed.' } // Belt-and-suspenders safety guard
          }
        }),
      'Tag',
      failedItems
    );
  }

  // 24. User sessions, then users, then user settings + profiles.
  //     User.userSettingsId and User.profileId are FKs pointing at UserSettings
  //     and Profile, so the User row must be deleted BEFORE its settings/profile.
  deletedCounts['UserSession'] = await safeDeleteMany(
    () =>
      prisma.userSession.deleteMany({
        where: { userId: { in: getIds('User') } }
      }),
    'UserSession',
    failedItems
  );

  // Users — double-gated: must be in tracked IDs AND email must end with @seed.invalid
  const userIds = getIds('User');
  if (userIds.length > 0) {
    deletedCounts['User'] = await safeDeleteMany(
      () =>
        prisma.user.deleteMany({
          where: {
            id: { in: userIds },
            email: { endsWith: '@seed.invalid' } // Safety gate
          }
        }),
      'User',
      failedItems
    );
  }

  deletedCounts['UserSettings'] = await safeDeleteMany(
    () =>
      prisma.userSettings.deleteMany({
        where: { id: { in: getIds('UserSettings') } }
      }),
    'UserSettings',
    failedItems
  );
  deletedCounts['Profile'] = await safeDeleteMany(
    () =>
      prisma.profile.deleteMany({ where: { id: { in: getIds('Profile') } } }),
    'Profile',
    failedItems
  );

  // ─── Stage 2: Revert shared mutations (integrated mode) ───────────────────

  let revertedMutationCounts = 0;
  const mutations = await getTrackedMutations(prisma, runId);

  for (const mutation of mutations) {
    if (!mutation.reversible || mutation.before === null) {
      warnings.push(
        `Non-reversible mutation on ${mutation.entityType} (${JSON.stringify(
          mutation.primaryKey
        )}) not reverted`
      );
      continue;
    }

    // Currently supports Forum counter reversals for integrated mode
    if (
      mutation.entityType === 'Forum' &&
      mutation.mutation === 'counter_increment'
    ) {
      try {
        const pk = mutation.primaryKey as { id: number };
        const before = mutation.before as Record<string, number>;
        await prisma.forum.update({
          where: { id: pk.id },
          data: before
        });
        revertedMutationCounts++;
      } catch (err) {
        warnings.push(
          `Failed to revert Forum mutation: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
    // Additional mutation types handled here as needed
  }

  // ─── Delete tracking tables ───────────────────────────────────────────────

  // DevSeedRecord rows (cascades from DevSeedRun deletion below)
  // We delete the run record which cascades to records + mutations
  try {
    await prisma.devSeedRun.update({
      where: { id: runId },
      data: {
        cleanupStatus: failedItems.length === 0 ? 'cleaned' : 'partial',
        updatedAt: new Date()
      }
    });
  } catch {
    // Run may have been deleted already
  }

  let status: CleanupResult['status'];
  if (failedItems.length === 0) {
    status = 'cleaned';
  } else if (failedItems.length < 5) {
    status = 'partial';
  } else {
    status = 'failed';
  }

  return {
    runId,
    status,
    deletedCounts,
    revertedMutationCounts,
    warnings,
    failedItems
  };
}
