import { RegistrationStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { sizeBytesToNumber } from '../lib/serialize';
import { AppError } from '../lib/errors';
import { isCommunityMember } from '../routes/api/communities/communities';
import { releaseCreditsSelect, withPrimaryArtist } from './releaseCredits';

const buildPlainTags = (
  releaseTags: Array<{ tag: { id: number; name: string; occurrences: number } }>
) =>
  releaseTags
    .map((releaseTag) => releaseTag.tag)
    .sort((a, b) => a.name.localeCompare(b.name));

const getAccessibleCommunity = async (
  communityId: number,
  userId: number
): Promise<{ registrationStatus: RegistrationStatus }> => {
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { registrationStatus: true }
  });
  if (!community) throw new AppError(404, 'Community not found');

  const isMember = await isCommunityMember(
    communityId,
    userId,
    community.registrationStatus
  );
  if (!isMember) throw new AppError(403, 'Not a member of this community');
  return community;
};

export const listCommunityReleases = async (input: {
  actorId: number;
  communityId: number;
  page: number;
  limit: number;
}) => {
  await getAccessibleCommunity(input.communityId, input.actorId);

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
