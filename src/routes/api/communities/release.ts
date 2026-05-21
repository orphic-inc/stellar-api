import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { asyncHandler, authHandler } from '../../../modules/asyncHandler';
import { requireAuth } from '../../../middleware/auth';
import { requirePermission } from '../../../middleware/permissions';
import { isCommunityMember } from './communities';
import {
  validate,
  validateParams,
  parsedParams,
  parsedBody
} from '../../../middleware/validate';
import {
  createGroupSchema,
  updateGroupSchema,
  releaseVoteSchema,
  releaseTagSchema,
  releaseTagVoteSchema,
  type CreateGroupInput,
  type UpdateGroupInput,
  type ReleaseVoteInput,
  type ReleaseTagInput,
  type ReleaseTagVoteInput
} from '../../../schemas/community';
import {
  addContributionToReleaseSchema,
  type AddContributionToReleaseInput
} from '../../../schemas/contribution';
import { addContributionToRelease } from '../../../modules/contribution';
import { emitNotifications } from '../../../lib/notifications';
import { recomputeVoteAggregate } from '../../../modules/top10';
import { getSettings } from '../../../modules/settings';
import {
  FileType,
  RegistrationStatus,
  ReleaseHistoryAction,
  ReleaseTagVoteDirection
} from '@prisma/client';
import { parsePage, paginatedResponse } from '../../../lib/pagination';

const router = express.Router({ mergeParams: true });
const communityIdParamsSchema = z.object({
  communityId: z.coerce.number().int().positive()
});
const releaseParamsSchema = z.object({
  communityId: z.coerce.number().int().positive(),
  releaseId: z.coerce.number().int().positive()
});

type ReleaseSnapshot = {
  title: string;
  description: string;
  image: string | null;
  year: number;
  isEdition: boolean;
  edition: unknown;
  tagIds: number[];
  tagNames: string[];
};

const getAccessibleCommunity = async (
  communityId: number,
  userId: number
): Promise<{ registrationStatus: RegistrationStatus } | null | 'forbidden'> => {
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { registrationStatus: true }
  });
  if (!community) return null;
  const isMember = await isCommunityMember(
    communityId,
    userId,
    community.registrationStatus
  );
  return isMember ? community : 'forbidden';
};

const snapshotRelease = (release: {
  title: string;
  description: string;
  image: string | null;
  year: number;
  isEdition: boolean;
  edition: unknown;
  releaseTags: Array<{ tag: { id: number; name: string } }>;
}): ReleaseSnapshot => ({
  title: release.title,
  description: release.description,
  image: release.image ?? null,
  year: release.year,
  isEdition: release.isEdition,
  edition: release.edition ?? null,
  tagIds: release.releaseTags.map((tag) => tag.tag.id).sort((a, b) => a - b),
  tagNames: release.releaseTags.map((tag) => tag.tag.name).sort()
});

const changedReleaseFields = (
  before: ReleaseSnapshot,
  after: ReleaseSnapshot
): string[] => {
  const changed: string[] = [];
  if (before.title !== after.title) changed.push('title');
  if (before.description !== after.description) changed.push('description');
  if (before.image !== after.image) changed.push('image');
  if (before.year !== after.year) changed.push('year');
  if (before.isEdition !== after.isEdition) changed.push('isEdition');
  if (JSON.stringify(before.edition) !== JSON.stringify(after.edition)) {
    changed.push('edition');
  }
  if (JSON.stringify(before.tagIds) !== JSON.stringify(after.tagIds)) {
    changed.push('tags');
  }
  return changed;
};

const summarizeReleaseChanges = (fields: string[]): string => {
  if (fields.length === 0) return 'Release metadata updated';
  const labels = fields.map((field) => {
    switch (field) {
      case 'isEdition':
        return 'edition flag';
      default:
        return field;
    }
  });
  return `Updated ${labels.join(', ')}`;
};

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
) => {
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

const buildPlainTags = (
  releaseTags: Array<{ tag: { id: number; name: string; occurrences: number } }>
) =>
  releaseTags
    .map((releaseTag) => releaseTag.tag)
    .sort((a, b) => a.name.localeCompare(b.name));

// GET /api/communities/:communityId/releases
router.get(
  '/',
  requireAuth,
  validateParams(communityIdParamsSchema),
  authHandler(async (req, res) => {
    const { communityId } = parsedParams<{ communityId: number }>(res);
    const community = await getAccessibleCommunity(communityId, req.user.id);
    if (!community) return res.status(404).json({ msg: 'Community not found' });
    if (community === 'forbidden') {
      return res.status(403).json({ msg: 'Not a member of this community' });
    }
    const pg = parsePage(req);
    const [releases, total] = await Promise.all([
      prisma.release.findMany({
        where: { communityId },
        skip: pg.skip,
        take: pg.limit,
        include: {
          artist: { select: { id: true, name: true } },
          releaseTags: { include: { tag: true } },
          _count: { select: { contributions: true } },
          contributions: {
            select: {
              id: true,
              type: true,
              sizeInBytes: true,
              linkStatus: true,
              user: { select: { id: true, username: true } },
              _count: { select: { consumers: true } }
            }
          }
        }
      }),
      prisma.release.count({ where: { communityId } })
    ]);
    paginatedResponse(
      res,
      releases.map((release) => ({
        ...release,
        tags: buildPlainTags(release.releaseTags)
      })),
      total,
      pg
    );
  })
);

// GET /api/communities/:communityId/releases/:releaseId
router.get(
  '/:releaseId',
  requireAuth,
  validateParams(releaseParamsSchema),
  authHandler(async (req, res) => {
    const { communityId, releaseId: id } = parsedParams<{
      communityId: number;
      releaseId: number;
    }>(res);
    const community = await getAccessibleCommunity(communityId, req.user.id);
    if (!community) return res.status(404).json({ msg: 'Community not found' });
    if (community === 'forbidden') {
      return res.status(403).json({ msg: 'Not a member of this community' });
    }
    const [release, myVoteRecord] = await Promise.all([
      prisma.release.findFirst({
        where: { id, communityId },
        include: {
          artist: true,
          releaseTags: {
            include: {
              tag: { select: { id: true, name: true, occurrences: true } },
              votes: {
                where: { userId: req.user.id },
                select: { direction: true }
              },
              user: { select: { id: true, username: true } }
            }
          },
          historyEntries: {
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            include: {
              actor: { select: { id: true, username: true } }
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
        where: { releaseId_userId: { releaseId: id, userId: req.user.id } },
        select: { positive: true }
      })
    ]);
    if (!release) return res.status(404).json({ msg: 'Release not found' });
    const myVote = myVoteRecord
      ? myVoteRecord.positive
        ? 'up'
        : 'down'
      : null;
    const releaseTags = buildReleaseTagPayload(
      buildPlainTags(release.releaseTags),
      release.releaseTags.map((releaseTag) => ({
        id: releaseTag.id,
        tagId: releaseTag.tag.id,
        positiveVotes: releaseTag.positiveVotes,
        negativeVotes: releaseTag.negativeVotes,
        createdAt: releaseTag.createdAt,
        user: releaseTag.user ?? null,
        votes: releaseTag.votes
      }))
    );

    res.json({
      ...release,
      tags: buildPlainTags(release.releaseTags),
      myVote,
      releaseTags,
      historyEntries: release.historyEntries
    });
  })
);

// POST /api/communities/:communityId/releases — requires communities_manage
router.post(
  '/',
  ...requirePermission('communities_manage'),
  validateParams(communityIdParamsSchema),
  validate(createGroupSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { communityId } = parsedParams<{ communityId: number }>(res);
    const community = await prisma.community.findUnique({
      where: { id: communityId }
    });
    if (!community) return res.status(404).json({ msg: 'Community not found' });

    const {
      artistId,
      title,
      description,
      type,
      releaseType,
      year,
      image,
      tagIds,
      isEdition,
      edition
    } = parsedBody<CreateGroupInput>(res);
    const uniqueTagIds = tagIds ? [...new Set(tagIds)] : [];

    const release = await prisma.$transaction(async (tx) => {
      const created = await tx.release.create({
        data: {
          artistId,
          communityId,
          title,
          description,
          type,
          releaseType,
          year,
          image: image ?? null,
          isEdition: isEdition ?? false,
          edition: (edition ?? undefined) as never
        }
      });

      if (uniqueTagIds.length > 0) {
        await tx.releaseTag.createMany({
          data: uniqueTagIds.map((tagId) => ({
            releaseId: created.id,
            tagId
          }))
        });
        await Promise.all(
          uniqueTagIds.map((tagId) =>
            tx.tag.update({
              where: { id: tagId },
              data: { occurrences: { increment: 1 } }
            })
          )
        );
      }

      const release = await tx.release.findUniqueOrThrow({
        where: { id: created.id },
        include: { artist: true, releaseTags: { include: { tag: true } } }
      });
      await tx.releaseHistory.create({
        data: {
          releaseId: release.id,
          actorId: req.user!.id,
          action: ReleaseHistoryAction.created,
          summary: 'Release created',
          changedFields: [],
          after: {
            title: release.title,
            artistName: release.artist.name,
            type: release.type,
            releaseType: release.releaseType,
            year: release.year,
            tagIds: uniqueTagIds
          } as never
        }
      });
      return {
        ...release,
        tags: buildPlainTags(release.releaseTags)
      };
    });
    res.status(201).json(release);
  })
);

// PUT /api/communities/:communityId/releases/:releaseId — requires communities_manage
router.put(
  '/:releaseId',
  ...requirePermission('communities_manage'),
  validateParams(releaseParamsSchema),
  validate(updateGroupSchema),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) return res.status(401).json({ msg: 'Unauthorized' });
    const actorId = req.user.id;
    const { communityId, releaseId: id } = parsedParams<{
      communityId: number;
      releaseId: number;
    }>(res);

    const existing = await prisma.release.findFirst({
      where: { id, communityId },
      include: {
        releaseTags: { include: { tag: { select: { id: true, name: true } } } }
      }
    });
    if (!existing) return res.status(404).json({ msg: 'Release not found' });

    const {
      title,
      description,
      image,
      year,
      isEdition,
      edition,
      tagIds,
      editSummary
    } = parsedBody<UpdateGroupInput>(res);
    const before = snapshotRelease(existing);
    const nextTagIds = tagIds
      ? [...new Set(tagIds)].sort((a, b) => a - b)
      : null;
    const removedTagIds =
      nextTagIds === null
        ? []
        : before.tagIds.filter((tagId) => !nextTagIds.includes(tagId));
    const addedTagIds =
      nextTagIds === null
        ? []
        : nextTagIds.filter((tagId) => !before.tagIds.includes(tagId));

    const release = await prisma.$transaction(async (tx) => {
      await tx.release.update({
        where: { id },
        data: {
          ...(title !== undefined && { title }),
          ...(description !== undefined && { description }),
          ...(image !== undefined && { image }),
          ...(year !== undefined && { year }),
          ...(isEdition !== undefined && { isEdition }),
          ...(edition !== undefined && { edition: edition as never })
        },
        include: { artist: true, releaseTags: { include: { tag: true } } }
      });

      if (removedTagIds.length > 0) {
        await tx.releaseTag.deleteMany({
          where: { releaseId: id, tagId: { in: removedTagIds } }
        });
        await Promise.all(
          removedTagIds.map((tagId) =>
            tx.tag.update({
              where: { id: tagId },
              data: { occurrences: { decrement: 1 } }
            })
          )
        );
      }

      if (addedTagIds.length > 0) {
        await tx.releaseTag.createMany({
          data: addedTagIds.map((tagId) => ({
            releaseId: id,
            tagId
          }))
        });
        await Promise.all(
          addedTagIds.map((tagId) =>
            tx.tag.update({
              where: { id: tagId },
              data: { occurrences: { increment: 1 } }
            })
          )
        );
      }

      const refreshed = await tx.release.findUniqueOrThrow({
        where: { id },
        include: { artist: true, releaseTags: { include: { tag: true } } }
      });

      const after = snapshotRelease(refreshed);
      const changedFields = changedReleaseFields(before, after);

      if (changedFields.length > 0) {
        await tx.releaseHistory.create({
          data: {
            releaseId: id,
            actorId,
            action: ReleaseHistoryAction.edit,
            summary:
              editSummary?.trim() || summarizeReleaseChanges(changedFields),
            changedFields,
            before: before as never,
            after: after as never
          }
        });
      }

      return {
        ...refreshed,
        tags: buildPlainTags(refreshed.releaseTags)
      };
    });
    res.json(release);
  })
);

// POST /api/communities/:communityId/releases/:releaseId/contributions — any authenticated user
router.post(
  '/:releaseId/contributions',
  requireAuth,
  validateParams(releaseParamsSchema),
  validate(addContributionToReleaseSchema),
  authHandler(async (req, res) => {
    const { communityId, releaseId } = parsedParams<{
      communityId: number;
      releaseId: number;
    }>(res);
    const input = parsedBody<AddContributionToReleaseInput>(res);

    const settings = await getSettings();
    if (settings.approvedDomains.length > 0) {
      let host: string;
      try {
        host = new URL(input.downloadUrl).hostname;
      } catch {
        return res.status(400).json({ msg: 'Invalid download URL' });
      }
      if (!settings.approvedDomains.includes(host)) {
        return res.status(400).json({
          msg: `Domain '${host}' is not in the approved domains list`
        });
      }
    }

    const community = await prisma.community.findUnique({
      where: { id: communityId },
      select: { allowDuplicateFormats: true }
    });
    if (!community) return res.status(404).json({ msg: 'Community not found' });

    if (!community.allowDuplicateFormats) {
      const existing = await prisma.contribution.findFirst({
        where: { releaseId, type: input.fileType as FileType }
      });
      if (existing) {
        return res.status(409).json({
          msg: `A ${input.fileType} contribution already exists for this release`
        });
      }
    }

    const contribution = await addContributionToRelease({
      userId: req.user.id,
      communityId,
      releaseId,
      input
    });
    if (!contribution)
      return res.status(404).json({ msg: 'Release not found' });

    await prisma.$transaction(async (tx) => {
      const subs = await tx.artistSubscription.findMany({
        where: { artistId: contribution.release.artistId },
        select: { userId: true }
      });
      if (subs.length > 0) {
        await emitNotifications(tx, {
          userIds: subs.map((s) => s.userId),
          type: 'artist_release',
          actorId: req.user.id,
          page: 'contributions',
          pageId: contribution.id
        });
      }
      await tx.releaseHistory.create({
        data: {
          releaseId: contribution.release.id,
          actorId: req.user.id,
          action: ReleaseHistoryAction.contribution_added,
          summary: `${contribution.type} contribution added`,
          changedFields: [],
          after: {
            contributionId: contribution.id,
            type: contribution.type,
            sizeInBytes: contribution.sizeInBytes ?? null,
            contributor: contribution.user?.username ?? null
          } as never
        }
      });
    });

    res.status(201).json(contribution);
  })
);

// ─── Vote routes ─────────────────────────────────────────────────────────────

const tagParamsSchema = z.object({
  communityId: z.coerce.number().int().positive(),
  releaseId: z.coerce.number().int().positive(),
  tagId: z.coerce.number().int().positive()
});

// POST /api/communities/:communityId/releases/:releaseId/vote
router.post(
  '/:releaseId/vote',
  requireAuth,
  validateParams(releaseParamsSchema),
  validate(releaseVoteSchema),
  authHandler(async (req, res) => {
    const { communityId, releaseId: id } = parsedParams<{
      communityId: number;
      releaseId: number;
    }>(res);
    const { positive } = parsedBody<ReleaseVoteInput>(res);
    const community = await getAccessibleCommunity(communityId, req.user.id);
    if (!community) return res.status(404).json({ msg: 'Community not found' });
    if (community === 'forbidden') {
      return res.status(403).json({ msg: 'Not a member of this community' });
    }

    const exists = await prisma.release.findFirst({
      where: { id, communityId },
      select: { id: true }
    });
    if (!exists) return res.status(404).json({ msg: 'Release not found' });

    await prisma.releaseVote.upsert({
      where: { releaseId_userId: { releaseId: id, userId: req.user.id } },
      create: { releaseId: id, userId: req.user.id, positive },
      update: { positive }
    });

    await recomputeVoteAggregate(id);

    const aggregate = await prisma.releaseVoteAggregate.findUnique({
      where: { releaseId: id }
    });
    res.json({ myVote: positive ? 'up' : 'down', voteAggregate: aggregate });
  })
);

// DELETE /api/communities/:communityId/releases/:releaseId/vote
router.delete(
  '/:releaseId/vote',
  requireAuth,
  validateParams(releaseParamsSchema),
  authHandler(async (req, res) => {
    const { communityId, releaseId: id } = parsedParams<{
      communityId: number;
      releaseId: number;
    }>(res);
    const community = await getAccessibleCommunity(communityId, req.user.id);
    if (!community) return res.status(404).json({ msg: 'Community not found' });
    if (community === 'forbidden') {
      return res.status(403).json({ msg: 'Not a member of this community' });
    }

    const exists = await prisma.release.findFirst({
      where: { id, communityId },
      select: { id: true }
    });
    if (!exists) return res.status(404).json({ msg: 'Release not found' });

    await prisma.releaseVote.deleteMany({
      where: { releaseId: id, userId: req.user.id }
    });

    await recomputeVoteAggregate(id);

    const aggregate = await prisma.releaseVoteAggregate.findUnique({
      where: { releaseId: id }
    });
    res.json({ myVote: null, voteAggregate: aggregate });
  })
);

// ─── Tag routes ───────────────────────────────────────────────────────────────

// POST /api/communities/:communityId/releases/:releaseId/tags
router.post(
  '/:releaseId/tags',
  requireAuth,
  validateParams(releaseParamsSchema),
  validate(releaseTagSchema),
  authHandler(async (req, res) => {
    const { communityId, releaseId: id } = parsedParams<{
      communityId: number;
      releaseId: number;
    }>(res);
    const { name } = parsedBody<ReleaseTagInput>(res);
    const community = await getAccessibleCommunity(communityId, req.user.id);
    if (!community) return res.status(404).json({ msg: 'Community not found' });
    if (community === 'forbidden') {
      return res.status(403).json({ msg: 'Not a member of this community' });
    }

    const release = await prisma.release.findFirst({
      where: { id, communityId },
      select: {
        id: true,
        releaseTags: { where: { tag: { name } }, select: { id: true } }
      }
    });
    if (!release) return res.status(404).json({ msg: 'Release not found' });
    if (release.releaseTags.length > 0)
      return res.status(409).json({ msg: 'Release already has this tag' });

    const tag = await prisma.$transaction(async (tx) => {
      const t = await tx.tag.upsert({
        where: { name },
        create: { name, occurrences: 1 },
        update: { occurrences: { increment: 1 } }
      });
      const releaseTag = await tx.releaseTag.create({
        data: {
          releaseId: id,
          tagId: t.id,
          userId: req.user.id,
          positiveVotes: 3,
          negativeVotes: 1
        },
        include: {
          tag: true,
          user: { select: { id: true, username: true } }
        }
      });
      await tx.releaseTagVote.create({
        data: {
          releaseTagId: releaseTag.id,
          userId: req.user.id,
          direction: ReleaseTagVoteDirection.up
        }
      });
      await tx.releaseHistory.create({
        data: {
          releaseId: id,
          actorId: req.user.id,
          action: ReleaseHistoryAction.tag_added,
          summary: `Tag "${t.name}" added`,
          changedFields: ['tags'],
          before: { tagId: t.id, name: t.name, score: 0 } as never,
          after: { tagId: t.id, name: t.name, score: 2 } as never
        }
      });
      return t;
    });

    res.status(201).json(tag);
  })
);

// POST /api/communities/:communityId/releases/:releaseId/tags/:tagId/vote
router.post(
  '/:releaseId/tags/:tagId/vote',
  requireAuth,
  validateParams(tagParamsSchema),
  validate(releaseTagVoteSchema),
  authHandler(async (req, res) => {
    const {
      communityId,
      releaseId: id,
      tagId
    } = parsedParams<{
      communityId: number;
      releaseId: number;
      tagId: number;
    }>(res);
    const { direction } = parsedBody<ReleaseTagVoteInput>(res);
    const community = await getAccessibleCommunity(communityId, req.user.id);
    if (!community) return res.status(404).json({ msg: 'Community not found' });
    if (community === 'forbidden') {
      return res.status(403).json({ msg: 'Not a member of this community' });
    }

    const releaseTag = await prisma.releaseTag.findFirst({
      where: { releaseId: id, tagId, release: { communityId } },
      select: { id: true, positiveVotes: true, negativeVotes: true }
    });
    if (!releaseTag) {
      return res.status(404).json({ msg: 'Release tag not found' });
    }

    const dir = direction as ReleaseTagVoteDirection;
    const oppositeDir =
      dir === ReleaseTagVoteDirection.up
        ? ReleaseTagVoteDirection.down
        : ReleaseTagVoteDirection.up;

    const [existingVote, oppositeVote] = await Promise.all([
      prisma.releaseTagVote.findUnique({
        where: {
          releaseTagId_userId_direction: {
            releaseTagId: releaseTag.id,
            userId: req.user.id,
            direction: dir
          }
        }
      }),
      prisma.releaseTagVote.findUnique({
        where: {
          releaseTagId_userId_direction: {
            releaseTagId: releaseTag.id,
            userId: req.user.id,
            direction: oppositeDir
          }
        }
      })
    ]);

    if (!existingVote) {
      await prisma.$transaction(async (tx) => {
        await tx.releaseTagVote.create({
          data: {
            releaseTagId: releaseTag.id,
            userId: req.user.id,
            direction: dir
          }
        });
        if (oppositeVote) {
          await tx.releaseTagVote.delete({ where: { id: oppositeVote.id } });
        }
        await tx.releaseTag.update({
          where: { id: releaseTag.id },
          data:
            dir === ReleaseTagVoteDirection.up
              ? {
                  positiveVotes: { increment: 2 },
                  ...(oppositeVote ? { negativeVotes: { decrement: 1 } } : {})
                }
              : {
                  negativeVotes: { increment: 1 },
                  ...(oppositeVote ? { positiveVotes: { decrement: 1 } } : {})
                }
        });
      });
    }

    const updated = await prisma.releaseTag.findUniqueOrThrow({
      where: { id: releaseTag.id },
      include: {
        tag: true,
        user: { select: { id: true, username: true } },
        votes: {
          where: { userId: req.user.id },
          select: { direction: true }
        }
      }
    });

    res.json(
      buildReleaseTagPayload(
        [
          {
            id: updated.tag.id,
            name: updated.tag.name,
            occurrences: updated.tag.occurrences
          }
        ],
        [
          {
            id: updated.id,
            tagId: updated.tag.id,
            positiveVotes: updated.positiveVotes,
            negativeVotes: updated.negativeVotes,
            createdAt: updated.createdAt,
            user: updated.user ?? null,
            votes: updated.votes
          }
        ]
      )[0]
    );
  })
);

// DELETE /api/communities/:communityId/releases/:releaseId/tags/:tagId
router.delete(
  '/:releaseId/tags/:tagId',
  ...requirePermission('communities_manage'),
  validateParams(tagParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) return res.status(401).json({ msg: 'Unauthorized' });
    const actorId = req.user.id;
    const {
      communityId,
      releaseId: id,
      tagId
    } = parsedParams<{
      communityId: number;
      releaseId: number;
      tagId: number;
    }>(res);

    const release = await prisma.release.findFirst({
      where: { id, communityId, releaseTags: { some: { tagId } } },
      select: { id: true }
    });
    if (!release)
      return res.status(404).json({ msg: 'Release or tag not found' });

    const tag = await prisma.tag.findUnique({
      where: { id: tagId },
      select: { name: true }
    });

    await prisma.$transaction(async (tx) => {
      await tx.releaseTag.deleteMany({
        where: { releaseId: id, tagId }
      });
      await tx.tag.update({
        where: { id: tagId },
        data: { occurrences: { decrement: 1 } }
      });
      await tx.releaseHistory.create({
        data: {
          releaseId: id,
          actorId,
          action: ReleaseHistoryAction.tag_removed,
          summary: `Tag "${tag?.name ?? `#${tagId}`}" removed`,
          changedFields: ['tags'],
          before: tag ? ({ tagId, name: tag.name } as never) : undefined
        }
      });
    });

    res.status(204).send();
  })
);

// DELETE /api/communities/:communityId/releases/:releaseId — requires communities_manage
router.delete(
  '/:releaseId',
  ...requirePermission('communities_manage'),
  validateParams(releaseParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { communityId, releaseId: id } = parsedParams<{
      communityId: number;
      releaseId: number;
    }>(res);
    const existing = await prisma.release.findFirst({
      where: { id, communityId },
      select: { id: true, releaseTags: { select: { tagId: true } } }
    });
    if (!existing) return res.status(404).json({ msg: 'Release not found' });
    await prisma.$transaction(async (tx) => {
      await Promise.all(
        existing.releaseTags.map((tag) =>
          tx.tag.update({
            where: { id: tag.tagId },
            data: { occurrences: { decrement: 1 } }
          })
        )
      );
      await tx.release.delete({ where: { id } });
    });
    res.status(204).send();
  })
);

export default router;
