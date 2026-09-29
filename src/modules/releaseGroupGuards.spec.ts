/**
 * The constraint guards on releaseGroup.ts, releaseGroupCovers.ts and
 * releaseWorkbench/tags.ts writes (#596, ADR-0048). Each is proved by failing
 * its write with the code it translates.
 */
import { Prisma } from '@prisma/client';
import { prismaMock, resetApiTestState } from '../test/apiTestHarness';

jest.mock('./communityAccess', () => ({
  ...jest.requireActual('./communityAccess'),
  assertCommunityAccess: () => Promise.resolve({ registrationStatus: 'open' })
}));
jest.mock('./releaseWorkbench/authority', () => ({
  loadReleaseWorkbenchAuthority: () => Promise.resolve({ canManageTags: true })
}));
jest.mock('./releaseWorkbench/load', () => ({
  getReleaseWorkbenchView: () => Promise.resolve({ view: true })
}));

import {
  createReleaseGroup,
  logGroupEvent,
  mergeReleaseGroups,
  setReleaseGroup,
  updateGroupIdentity
} from './releaseGroup';
import { removeGroupCover } from './releaseGroupCovers';
import {
  removeReleaseWorkbenchTag,
  voteOnReleaseWorkbenchTag
} from './releaseWorkbench/tags';

const prismaErr = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test'
  });

const refusal = (statusCode: number, message: string) =>
  expect.objectContaining({ statusCode, message });

/** A group the resolver finds for the viewer: it has one visible release. */
const resolvableGroup = (id: number, title = 'Kind of Blue') =>
  ({
    id,
    title,
    year: 1959,
    artist: null,
    releases: [
      {
        id: 3,
        title,
        year: 1959,
        image: null,
        communityId: 1,
        community: { id: 1, name: 'Jazz' },
        credits: []
      }
    ]
  }) as never;

beforeEach(() => {
  resetApiTestState();
  prismaMock.$transaction.mockImplementation((async (arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock)
      : Promise.all(arg as Promise<unknown>[])) as never);
});

describe('releaseGroup.ts', () => {
  it('createReleaseGroup answers the racing writer’s group as found', async () => {
    const raced = { id: 8, title: 'T', year: null, artist: null };
    prismaMock.releaseGroup.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(raced as never);
    prismaMock.releaseGroup.create.mockRejectedValue(prismaErr('P2002'));
    await expect(createReleaseGroup({ title: 'T' })).resolves.toEqual(
      expect.objectContaining({ created: false })
    );
  });

  describe('setReleaseGroup, after its reads went stale', () => {
    const attach = () =>
      setReleaseGroup({
        actorId: 7,
        communityId: 1,
        releaseId: 3,
        releaseGroupId: 5
      });

    beforeEach(() => {
      prismaMock.release.findFirst.mockResolvedValue({ id: 3 } as never);
      prismaMock.releaseGroup.findUnique.mockResolvedValue({ id: 5 } as never);
    });

    it('answers the missing-release 404 when the release went', async () => {
      prismaMock.release.update.mockRejectedValue(prismaErr('P2025'));
      await expect(attach()).rejects.toEqual(refusal(404, 'Release not found'));
    });

    it('answers the unknown-group 400 when a merge took the group', async () => {
      prismaMock.release.update.mockRejectedValue(prismaErr('P2003'));
      await expect(attach()).rejects.toEqual(
        refusal(400, 'No release group with that id')
      );
    });
  });

  it('logGroupEvent answers 404 when a merge took the group', async () => {
    prismaMock.groupLog.create.mockRejectedValue(prismaErr('P2003'));
    await expect(logGroupEvent(prismaMock as never, 5, 7, 'x')).rejects.toEqual(
      refusal(404, 'Release group not found')
    );
  });

  it('mergeReleaseGroups answers 404 when a concurrent merge took the source', async () => {
    prismaMock.releaseGroup.findFirst
      .mockResolvedValueOnce(resolvableGroup(5))
      .mockResolvedValueOnce(resolvableGroup(9));
    prismaMock.release.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.coverArt.findMany.mockResolvedValue([]);
    prismaMock.groupLog.create.mockResolvedValue({} as never);
    prismaMock.releaseGroup.delete.mockRejectedValue(prismaErr('P2025'));
    await expect(
      mergeReleaseGroups({ actorId: 7, targetId: 5, sourceId: 9 })
    ).rejects.toEqual(refusal(404, 'Release group not found'));
  });

  describe('updateGroupIdentity, after its clash check went stale', () => {
    const rename = () =>
      updateGroupIdentity({ actorId: 7, groupId: 5, title: 'Kind Of Blue!' });

    beforeEach(() => {
      prismaMock.releaseGroup.findFirst.mockResolvedValue(resolvableGroup(5));
      prismaMock.releaseGroup.findUnique.mockResolvedValue(null);
    });

    it('answers 409 when a concurrent rename took the identity', async () => {
      prismaMock.releaseGroup.update.mockRejectedValue(prismaErr('P2002'));
      await expect(rename()).rejects.toEqual(
        expect.objectContaining({ statusCode: 409 })
      );
      expect(prismaMock.groupLog.create).not.toHaveBeenCalled();
    });

    it('answers 404 when a merge took the group', async () => {
      prismaMock.releaseGroup.update.mockRejectedValue(prismaErr('P2025'));
      await expect(rename()).rejects.toEqual(
        refusal(404, 'Release group not found')
      );
    });
  });

  it('removeGroupCover answers 404 when a concurrent removal won', async () => {
    prismaMock.releaseGroup.findFirst.mockResolvedValue(resolvableGroup(5));
    prismaMock.coverArt.findFirst.mockResolvedValue({
      id: 2,
      userId: 7,
      image: 'https://x.test/c.png'
    } as never);
    prismaMock.coverArt.delete.mockRejectedValue(prismaErr('P2025'));
    await expect(
      removeGroupCover({
        actorId: 7,
        groupId: 5,
        coverId: 2,
        canModerate: false
      })
    ).rejects.toEqual(refusal(404, 'Cover not found'));
    expect(prismaMock.groupLog.create).not.toHaveBeenCalled();
  });
});

describe('releaseWorkbench/tags.ts', () => {
  const ref = { actorId: 7, communityId: 1, releaseId: 3 } as never;

  describe('voteOnReleaseWorkbenchTag', () => {
    const vote = () =>
      voteOnReleaseWorkbenchTag(ref, { tagId: 4, direction: 'up' });

    beforeEach(() => {
      prismaMock.releaseTag.findFirst.mockResolvedValue({ id: 11 } as never);
      prismaMock.releaseTagVote.findUnique.mockResolvedValue(null);
    });

    // Two identical votes both passed the existing-vote read; the loser's
    // vote is already recorded, so it answers as an already-voted caller.
    it('answers the current tag when a concurrent identical vote won', async () => {
      prismaMock.releaseTagVote.create.mockRejectedValue(prismaErr('P2002'));
      prismaMock.releaseTag.findUniqueOrThrow.mockResolvedValue({
        id: 11,
        positiveVotes: 3,
        negativeVotes: 0,
        createdAt: new Date(),
        user: null,
        votes: [{ direction: 'up' }],
        tag: { id: 4, name: 'jazz', occurrences: 2 }
      } as never);
      await expect(vote()).resolves.toEqual(
        expect.objectContaining({ id: 11, myVotes: { up: true, down: false } })
      );
    });

    it.each(['P2003', 'P2025'])(
      'answers the missing-tag 404 when the tag was removed (%s)',
      async (code) => {
        prismaMock.releaseTagVote.create.mockRejectedValue(prismaErr(code));
        await expect(vote()).rejects.toEqual(
          refusal(404, 'Release tag not found')
        );
        expect(prismaMock.releaseTag.findUniqueOrThrow).not.toHaveBeenCalled();
      }
    );
  });

  it('removeReleaseWorkbenchTag answers 404 when the release went', async () => {
    prismaMock.release.findFirst.mockResolvedValue({ id: 3 } as never);
    prismaMock.tag.findUnique.mockResolvedValue({ name: 'jazz' } as never);
    prismaMock.release.findUniqueOrThrow.mockRejectedValue(prismaErr('P2025'));
    await expect(removeReleaseWorkbenchTag(ref, { tagId: 4 })).rejects.toEqual(
      refusal(404, 'Release or tag not found')
    );
    expect(prismaMock.releaseHistory.create).not.toHaveBeenCalled();
  });
});
