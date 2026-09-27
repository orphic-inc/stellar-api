import { ArtistRole, ReleaseHistoryAction } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { translatePrismaError } from '../../lib/prismaErrors';
import { assertArtistLive } from '../artist';
import { loadReleaseWorkbenchAuthority } from './authority';
import type { ReleaseCreditView, ReleaseWorkbenchRef } from './types';

/**
 * Artist credits on an existing release (#721). Anyone who can see the release
 * may add one; a moderator or the credit's own adder may change its role or
 * remove it. Each operation writes one history row, and none is revertable:
 * credits are not part of the release snapshot.
 */

export const releaseCreditSelect = {
  id: true,
  role: true,
  addedById: true,
  artist: { select: { id: true, name: true } }
} as const;

const DUPLICATE_CREDIT = 'That artist already holds this role on the release';
const CREDIT_NOT_FOUND = 'Credit not found';

type CreditFacts = { artistId: number; name: string; role: ArtistRole };

const factsOf = (credit: ReleaseCreditView): CreditFacts => ({
  artistId: credit.artist.id,
  name: credit.artist.name,
  role: credit.role
});

const assertReleaseInCommunity = async (ref: ReleaseWorkbenchRef) => {
  const release = await prisma.release.findFirst({
    where: { id: ref.releaseId, communityId: ref.communityId },
    select: { id: true }
  });
  if (!release) throw new AppError(404, 'Release not found');
};

/** The credit, if the actor may change or remove it: a moderator or its adder. */
const loadManageableCredit = async (
  ref: ReleaseWorkbenchRef,
  creditId: number
): Promise<ReleaseCreditView> => {
  const authority = await loadReleaseWorkbenchAuthority(ref);
  const credit = await prisma.releaseArtist.findFirst({
    where: {
      id: creditId,
      releaseId: ref.releaseId,
      release: { communityId: ref.communityId }
    },
    select: releaseCreditSelect
  });
  if (!credit) throw new AppError(404, CREDIT_NOT_FOUND);
  if (!authority.canManageCredits && credit.addedById !== ref.actorId) {
    throw new AppError(403, 'Permission denied');
  }
  return credit;
};

export const addReleaseWorkbenchCredit = async (
  ref: ReleaseWorkbenchRef,
  input: { artistId: number; role: ArtistRole }
): Promise<ReleaseCreditView> => {
  await loadReleaseWorkbenchAuthority(ref);
  await assertReleaseInCommunity(ref);
  await assertArtistLive(input.artistId);

  try {
    return await prisma.$transaction(async (tx) => {
      const credit = await tx.releaseArtist.create({
        data: {
          releaseId: ref.releaseId,
          artistId: input.artistId,
          role: input.role,
          addedById: ref.actorId
        },
        select: releaseCreditSelect
      });
      await tx.releaseHistory.create({
        data: {
          releaseId: ref.releaseId,
          actorId: ref.actorId,
          action: ReleaseHistoryAction.credit_added,
          summary: `Added ${credit.artist.name} as ${credit.role}`,
          changedFields: ['credits'],
          after: factsOf(credit)
        }
      });
      return credit;
    });
  } catch (err) {
    translatePrismaError(err, { P2002: [409, DUPLICATE_CREDIT] });
  }
};

export const changeReleaseWorkbenchCreditRole = async (
  ref: ReleaseWorkbenchRef,
  input: { creditId: number; role: ArtistRole }
): Promise<ReleaseCreditView> => {
  const credit = await loadManageableCredit(ref, input.creditId);
  if (credit.role === input.role) return credit;

  try {
    return await prisma.$transaction(async (tx) => {
      // `addedById` is left alone: the role is corrected, the attribution kept.
      const updated = await tx.releaseArtist.update({
        where: { id: credit.id },
        data: { role: input.role },
        select: releaseCreditSelect
      });
      await tx.releaseHistory.create({
        data: {
          releaseId: ref.releaseId,
          actorId: ref.actorId,
          action: ReleaseHistoryAction.credit_role_changed,
          summary: `Changed ${credit.artist.name} from ${credit.role} to ${updated.role}`,
          changedFields: ['credits'],
          before: factsOf(credit),
          after: factsOf(updated)
        }
      });
      return updated;
    });
  } catch (err) {
    translatePrismaError(err, {
      P2002: [409, DUPLICATE_CREDIT],
      P2025: [404, CREDIT_NOT_FOUND]
    });
  }
};

export const removeReleaseWorkbenchCredit = async (
  ref: ReleaseWorkbenchRef,
  input: { creditId: number }
): Promise<void> => {
  const credit = await loadManageableCredit(ref, input.creditId);

  try {
    await prisma.$transaction(async (tx) => {
      // Lock the release so two concurrent removals cannot each see the other's
      // credit as the survivor and together leave none.
      await tx.$queryRaw`
        SELECT "id" FROM "releases" WHERE "id" = ${ref.releaseId} FOR UPDATE
      `;
      const remaining = await tx.releaseArtist.count({
        where: { releaseId: ref.releaseId }
      });
      if (remaining <= 1) {
        throw new AppError(409, 'A release keeps at least one artist credit');
      }
      await tx.releaseArtist.delete({ where: { id: credit.id } });
      await tx.releaseHistory.create({
        data: {
          releaseId: ref.releaseId,
          actorId: ref.actorId,
          action: ReleaseHistoryAction.credit_removed,
          summary: `Removed ${credit.artist.name} (${credit.role})`,
          changedFields: ['credits'],
          before: factsOf(credit)
        }
      });
    });
  } catch (err) {
    translatePrismaError(err, { P2025: [404, CREDIT_NOT_FOUND] });
  }
};
