import { ReleaseTagVoteDirection } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import type {
  ReleaseHistoryPage,
  ReleaseTagView,
  ReleaseWorkbenchRef,
  ReleaseWorkbenchView
} from './types';
import { loadReleaseWorkbenchAuthority } from './authority';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

const normalizePage = (page?: number, limit?: number) => {
  const safePage = Math.max(1, page ?? 1);
  const safeLimit = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, limit ?? DEFAULT_PAGE_SIZE)
  );
  return { page: safePage, limit: safeLimit, skip: (safePage - 1) * safeLimit };
};

const buildPlainTags = (
  releaseTags: Array<{ tag: { id: number; name: string; occurrences: number } }>
) =>
  releaseTags
    .map((releaseTag) => releaseTag.tag)
    .sort((a, b) => a.name.localeCompare(b.name));

const buildReleaseTagPayload = (
  tags: Array<{ id: number; name: string; occurrences: number }>,
  releaseTags: Array<{
    id: number;
    tagId: number;
    positiveVotes: number;
    negativeVotes: number;
    createdAt: Date;
    user: { id: number; username: string } | null;
    votes: Array<{ direction: ReleaseTagVoteDirection }>;
  }>
): ReleaseTagView[] => {
  const byTagId = new Map(
    releaseTags.map((releaseTag) => [releaseTag.tagId, releaseTag])
  );

  return tags
    .map((tag) => {
      const releaseTag = byTagId.get(tag.id);
      const positiveVotes = releaseTag?.positiveVotes ?? 1;
      const negativeVotes = releaseTag?.negativeVotes ?? 1;

      return {
        id: releaseTag?.id ?? tag.id,
        tagId: tag.id,
        name: tag.name,
        occurrences: tag.occurrences,
        score: positiveVotes - negativeVotes,
        positiveVotes: Math.max(0, positiveVotes - 1),
        negativeVotes: Math.max(0, negativeVotes - 1),
        addedBy: releaseTag?.user ?? null,
        createdAt: releaseTag?.createdAt ?? null,
        myVotes: {
          up:
            releaseTag?.votes.some(
              (vote) => vote.direction === ReleaseTagVoteDirection.up
            ) ?? false,
          down:
            releaseTag?.votes.some(
              (vote) => vote.direction === ReleaseTagVoteDirection.down
            ) ?? false
        }
      };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
};

export const getReleaseWorkbenchView = async (
  ref: ReleaseWorkbenchRef,
  options: { requireCommunityAccess?: boolean } = {}
): Promise<ReleaseWorkbenchView> => {
  const permissions = await loadReleaseWorkbenchAuthority(ref, {
    requireCommunityAccess: options.requireCommunityAccess
  });

  const [release, myVoteRecord] = await Promise.all([
    prisma.release.findFirst({
      where: { id: ref.releaseId, communityId: ref.communityId },
      include: {
        credits: {
          select: { role: true, artist: { select: { id: true, name: true } } }
        },
        releaseTags: {
          include: {
            tag: { select: { id: true, name: true, occurrences: true } },
            votes: {
              where: { userId: ref.actorId },
              select: { direction: true }
            },
            user: { select: { id: true, username: true } }
          }
        },
        voteAggregate: true,
        contributions: {
          select: {
            id: true,
            userId: true,
            releaseId: true,
            contributorId: true,
            releaseDescription: true,
            sizeInBytes: true,
            approvedAccountingBytes: true,
            linkStatus: true,
            linkCheckedAt: true,
            type: true,
            createdAt: true,
            updatedAt: true,
            user: { select: { id: true, username: true } },
            collaborators: true
          }
        }
      }
    }),
    prisma.releaseVote.findUnique({
      where: {
        releaseId_userId: { releaseId: ref.releaseId, userId: ref.actorId }
      },
      select: { positive: true }
    })
  ]);

  if (!release) {
    throw new AppError(404, 'Release not found');
  }

  const myVote = myVoteRecord ? (myVoteRecord.positive ? 'up' : 'down') : null;
  const releaseTagsRaw = release.releaseTags ?? [];
  const contributions = release.contributions ?? [];
  const tags = buildPlainTags(releaseTagsRaw);
  const releaseTags = buildReleaseTagPayload(
    tags,
    releaseTagsRaw.map((releaseTag) => ({
      id: releaseTag.id,
      tagId: releaseTag.tag.id,
      positiveVotes: releaseTag.positiveVotes,
      negativeVotes: releaseTag.negativeVotes,
      createdAt: releaseTag.createdAt,
      user: releaseTag.user ?? null,
      votes: releaseTag.votes
    }))
  );
  const isContributor = contributions.some(
    (contribution) => contribution.userId === ref.actorId
  );
  const releaseView = { ...release };
  delete (releaseView as { releaseTags?: unknown }).releaseTags;
  delete (releaseView as { contributions?: unknown }).contributions;

  return {
    release: {
      ...releaseView,
      contributions,
      voteAggregate: release.voteAggregate ?? null
    },
    tags,
    myVote,
    releaseTags,
    isContributor,
    permissions: {
      canEditMetadata: permissions.canEditMetadata,
      canManageTags: permissions.canManageTags,
      canVote: permissions.canVote,
      canAttachContribution: permissions.canAttachContribution,
      canRevertHistory: permissions.canRevertHistory
    }
  };
};

export const getReleaseWorkbenchHistoryPage = async (
  ref: ReleaseWorkbenchRef,
  input: { page?: number; limit?: number }
): Promise<ReleaseHistoryPage> => {
  await loadReleaseWorkbenchAuthority(ref);

  const release = await prisma.release.findFirst({
    where: { id: ref.releaseId, communityId: ref.communityId },
    select: { id: true }
  });
  if (!release) {
    throw new AppError(404, 'Release not found');
  }

  const pg = normalizePage(input.page, input.limit);
  const [entries, total] = await Promise.all([
    prisma.releaseHistory.findMany({
      where: { releaseId: ref.releaseId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: pg.skip,
      take: pg.limit,
      include: { actor: { select: { id: true, username: true } } }
    }),
    prisma.releaseHistory.count({ where: { releaseId: ref.releaseId } })
  ]);

  return {
    data: entries,
    page: pg.page,
    limit: pg.limit,
    total,
    totalPages: Math.ceil(total / pg.limit)
  };
};
