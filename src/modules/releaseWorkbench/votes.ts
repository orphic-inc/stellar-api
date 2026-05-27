import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { recomputeVoteAggregate } from '../top10';
import { loadReleaseWorkbenchAuthority } from './authority';
import { getReleaseWorkbenchView } from './load';
import type { ReleaseWorkbenchRef, ReleaseWorkbenchView } from './types';

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
