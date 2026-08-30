import { prisma } from '../lib/prisma';
import { sizeBytesToNumber } from '../lib/serialize';
import { assertCommunityAccess } from './communityAccess';
import { releaseCreditsSelect, withPrimaryArtist } from './releaseCredits';
import { buildPlainTags } from './releaseTags';

export const listCommunityReleases = async (input: {
  actorId: number;
  communityId: number;
  page: number;
  limit: number;
}) => {
  await assertCommunityAccess(input.communityId, input.actorId);

  const skip = (input.page - 1) * input.limit;
  const [releases, total] = await Promise.all([
    prisma.release.findMany({
      where: { communityId: input.communityId },
      skip,
      take: input.limit,
      include: {
        credits: releaseCreditsSelect,
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
    prisma.release.count({ where: { communityId: input.communityId } })
  ]);

  return {
    data: releases.map((release) => ({
      ...withPrimaryArtist(release),
      contributions: release.contributions.map((c) => ({
        ...c,
        sizeInBytes: sizeBytesToNumber(c.sizeInBytes)
      })),
      tags: buildPlainTags(release.releaseTags)
    })),
    total
  };
};
