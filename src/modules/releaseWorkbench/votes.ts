import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { translatePrismaError } from '../../lib/prismaErrors';
import { binomialScore } from '../top10';
import { loadReleaseWorkbenchAuthority } from './authority';
import { getReleaseWorkbenchView } from './load';
import type { ReleaseWorkbenchRef, ReleaseWorkbenchView } from './types';

/**
 * Recount a release's votes into its aggregate. Lives beside the vote write, its
 * only caller, rather than in `top10.ts`, which reads the aggregate to rank.
 *
 * A native ON CONFLICT upsert, so it cannot race to P2002. A vote `clear`
 * meets no foreign key before this, so this is where a release that vanished
 * mid-vote first shows (#819).
 */
export async function recomputeVoteAggregate(releaseId: number): Promise<void> {
  const [total, ups] = await Promise.all([
    prisma.releaseVote.count({ where: { releaseId } }),
    prisma.releaseVote.count({ where: { releaseId, positive: true } })
  ]);

  const score = binomialScore(ups, total);

  try {
    await prisma.releaseVoteAggregate.upsert({
      where: { releaseId },
      create: { releaseId, ups, total, score },
      update: { ups, total, score }
    });
  } catch (err) {
    translatePrismaError(err, { P2003: [404, 'Release not found'] });
  }
}

export const voteOnReleaseWorkbench = async (
  ref: ReleaseWorkbenchRef,
  input: { direction: 'up' | 'down' | 'clear' }
): Promise<ReleaseWorkbenchView> => {
  const authority = await loadReleaseWorkbenchAuthority(ref);
  if (!authority.canVote) {
    throw new AppError(403, 'Not authorized');
  }

  const exists = await prisma.release.findFirst({
    where: { id: ref.releaseId, communityId: ref.communityId },
    select: { id: true }
  });
  if (!exists) {
    throw new AppError(404, 'Release not found');
  }

  if (input.direction === 'clear') {
    await prisma.releaseVote.deleteMany({
      where: { releaseId: ref.releaseId, userId: ref.actorId }
    });
  } else {
    // A native ON CONFLICT upsert, so it cannot race to P2002. The release can
    // still vanish after the read above (#793); answer as that read does (#818).
    try {
      await prisma.releaseVote.upsert({
        where: {
          releaseId_userId: { releaseId: ref.releaseId, userId: ref.actorId }
        },
        create: {
          releaseId: ref.releaseId,
          userId: ref.actorId,
          positive: input.direction === 'up'
        },
        update: { positive: input.direction === 'up' }
      });
    } catch (err) {
      translatePrismaError(err, { P2003: [404, 'Release not found'] });
    }
  }

  await recomputeVoteAggregate(ref.releaseId);
  const aggregate = await prisma.releaseVoteAggregate.findUnique({
    where: { releaseId: ref.releaseId }
  });
  const view = await getReleaseWorkbenchView(ref);
  return {
    ...view,
    myVote: input.direction === 'clear' ? null : input.direction,
    release: {
      ...view.release,
      voteAggregate: aggregate
    }
  };
};
