/**
 * A release group's covers (ADR-0023, #265): list, add, remove. Moved out of
 * releaseGroup.ts (#596); every verb still reaches the group only through
 * `resolveGroupForViewer`, so seeing or changing a cover means seeing the group.
 */
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { translatePrismaError } from '../lib/prismaErrors';
import { registerWriteImages } from './remoteImage';
import { logGroupEvent, resolveGroupForViewer } from './releaseGroup';

const coverSelect = {
  id: true,
  image: true,
  summary: true,
  userId: true,
  addedAt: true,
  user: { select: { id: true, username: true } }
} as const;

/**
 * Covers, like everything else here, are reachable only through the resolver:
 * seeing a group's cover art means being able to see the group.
 */
export const listGroupCovers = async (
  groupId: number,
  viewerId: number,
  page: { skip: number; limit: number }
) => {
  await resolveGroupForViewer(groupId, viewerId);
  const where = { releaseGroupId: groupId };
  const [data, total] = await Promise.all([
    prisma.coverArt.findMany({
      where,
      select: coverSelect,
      orderBy: [{ addedAt: 'asc' }, { id: 'asc' }],
      skip: page.skip,
      take: page.limit
    }),
    prisma.coverArt.count({ where })
  ]);
  return { data, total };
};

/** Adding a cover needs no permission beyond reaching the group — it is
 *  curation, like attaching a release. Removing someone else's does. */
export const addGroupCover = async (input: {
  actorId: number;
  groupId: number;
  image: string;
  summary?: string | null;
}) => {
  await resolveGroupForViewer(input.groupId, input.actorId);
  // After the access check and before the write, so a 429 refuses it whole.
  await registerWriteImages({ fields: [input.image] }, input.actorId);

  return prisma.$transaction(async (tx) => {
    let cover;
    try {
      cover = await tx.coverArt.create({
        data: {
          releaseGroupId: input.groupId,
          image: input.image,
          summary: input.summary ?? null,
          userId: input.actorId
        },
        select: coverSelect
      });
    } catch (err) {
      translatePrismaError(err, {
        P2002: [409, 'This group already carries that cover'],
        P2003: [404, 'Release group not found']
      });
    }
    await logGroupEvent(
      tx,
      input.groupId,
      input.actorId,
      `Added a cover: ${input.image}`
    );
    return cover;
  });
};

/**
 * Remove a cover. The adder may remove their own; removing anyone else's needs
 * `contributions_manage`, which the route resolves and passes in — the module
 * takes the decision, not the permission map, so the rule is testable without
 * a request.
 */
export const removeGroupCover = async (input: {
  actorId: number;
  groupId: number;
  coverId: number;
  canModerate: boolean;
}) => {
  await resolveGroupForViewer(input.groupId, input.actorId);

  const cover = await prisma.coverArt.findFirst({
    where: { id: input.coverId, releaseGroupId: input.groupId },
    select: { id: true, userId: true, image: true }
  });
  if (!cover) throw new AppError(404, 'Cover not found');

  if (cover.userId !== input.actorId && !input.canModerate) {
    throw new AppError(
      403,
      'Only the member who added this cover may remove it'
    );
  }

  await prisma.$transaction(async (tx) => {
    try {
      await tx.coverArt.delete({ where: { id: cover.id } });
    } catch (err) {
      // Another removal of the same cover won the race (#596).
      translatePrismaError(err, { P2025: [404, 'Cover not found'] });
    }
    await logGroupEvent(
      tx,
      input.groupId,
      input.actorId,
      `Removed a cover: ${cover.image}`
    );
  });
};
