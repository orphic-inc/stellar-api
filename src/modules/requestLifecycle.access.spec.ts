/**
 * Community access on every id-addressed request surface (#755, an instance of
 * #771), and on the contribution `fillRequest` names (#774).
 *
 * The reads have scoped by `requestVisibleTo` since #547; the writes, the
 * bounty history and `createRequest`'s community did not. Each surface now
 * finds a request the caller cannot reach exactly as it finds a missing one:
 * the same answer, and nothing written. The real-DB evidence is in
 * integration/requests.access.integration.ts.
 */

import { ReleaseType } from '@prisma/client';
import {
  communityReadableWhere,
  contributionVisibleTo,
  requestVisibleTo
} from './communityAccess';

const mockTx = {
  user: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  request: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn()
  },
  community: { findFirst: jest.fn() },
  requestBounty: { findMany: jest.fn() },
  economyTransaction: { create: jest.fn() },
  contribution: { findFirst: jest.fn() }
};

const mockPrisma = {
  $transaction: jest.fn(),
  request: { findFirst: jest.fn(), update: jest.fn() },
  requestBounty: { findMany: jest.fn() },
  requestAction: { findMany: jest.fn() },
  requestVote: { findUnique: jest.fn(), create: jest.fn(), delete: jest.fn() }
};

// A getter: communityAccess (imported above) loads lib/prisma before
// `mockPrisma` is initialised.
jest.mock('../lib/prisma', () => ({
  get prisma() {
    return mockPrisma;
  }
}));

jest.mock('./config', () => ({
  economy: { minimumBounty: 104857600 },
  logging: {}
}));

import {
  addBounty,
  createRequest,
  deleteRequest,
  fillRequest,
  getBountyHistory,
  MINIMUM_BOUNTY,
  toggleVote,
  unfillRequest,
  updateRequest
} from './requestLifecycle';

const ACTOR = 7;

/** The request pre-read's `where`, as it must carry the actor's scope. */
const scoped = expect.objectContaining({
  id: 10,
  ...requestVisibleTo(ACTOR)
});

const notFound = expect.objectContaining({ statusCode: 404 });

beforeEach(() => {
  mockPrisma.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: typeof mockTx) => Promise<unknown>)(mockTx)
      : Promise.all(arg as Promise<unknown>[])
  );
  // Every request lookup finds nothing: the request is hidden (or missing).
  mockTx.request.findFirst.mockResolvedValue(null);
  mockPrisma.request.findFirst.mockResolvedValue(null);
});

describe('a request the caller cannot reach', () => {
  it('getBountyHistory answers 404 and reads no history', async () => {
    await expect(getBountyHistory(10, ACTOR)).rejects.toEqual(notFound);
    expect(mockPrisma.request.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: scoped })
    );
    expect(mockPrisma.requestBounty.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.requestAction.findMany).not.toHaveBeenCalled();
  });

  it('toggleVote answers 404 and writes no vote', async () => {
    await expect(toggleVote(10, ACTOR)).rejects.toEqual(notFound);
    expect(mockPrisma.request.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: scoped })
    );
    expect(mockPrisma.requestVote.create).not.toHaveBeenCalled();
    expect(mockPrisma.requestVote.delete).not.toHaveBeenCalled();
  });

  it('updateRequest answers 404 and writes nothing', async () => {
    await expect(
      updateRequest({
        requestId: 10,
        actorId: ACTOR,
        canModerateRequests: true,
        input: { title: 'x', image: undefined }
      })
    ).rejects.toEqual(notFound);
    expect(mockPrisma.request.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: scoped })
    );
    expect(mockPrisma.request.update).not.toHaveBeenCalled();
  });

  it('addBounty answers 404 before its claim or any debit', async () => {
    await expect(addBounty(ACTOR, 10, MINIMUM_BOUNTY)).rejects.toEqual(
      notFound
    );
    expect(mockTx.request.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: scoped })
    );
    expect(mockTx.request.updateMany).not.toHaveBeenCalled();
    expect(mockTx.user.updateMany).not.toHaveBeenCalled();
  });

  it('fillRequest answers 404 before its claim', async () => {
    mockTx.contribution.findFirst.mockResolvedValue({
      id: 5,
      userId: ACTOR,
      release: { communityId: 1, type: 'Music' }
    });
    await expect(fillRequest(ACTOR, 10, 5)).rejects.toEqual(notFound);
    expect(mockTx.request.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        ...requestVisibleTo(ACTOR),
        id: 10,
        status: 'open'
      })
    });
    expect(mockTx.request.updateMany).not.toHaveBeenCalled();
    expect(mockTx.user.update).not.toHaveBeenCalled();
  });

  // No moderator bypass (#771): a moderator who cannot reach the community
  // finds its requests missing, as everyone else does.
  it.each([
    [
      'unfillRequest',
      () =>
        unfillRequest({
          requestId: 10,
          actorId: ACTOR,
          canModerateRequests: true
        })
    ],
    [
      'deleteRequest',
      () =>
        deleteRequest({
          requestId: 10,
          actorId: ACTOR,
          canModerateRequests: true
        })
    ]
  ])(
    '%s answers 404 to a moderator and claims nothing',
    async (_name, call) => {
      await expect(call()).rejects.toEqual(notFound);
      expect(mockTx.request.findFirst).toHaveBeenCalledWith({
        where: scoped
      });
      expect(mockTx.request.updateMany).not.toHaveBeenCalled();
      expect(mockTx.user.updateMany).not.toHaveBeenCalled();
    }
  );
});

describe('fillRequest with a contribution the caller cannot see (#774)', () => {
  it('answers the missing-contribution 404 before any request read', async () => {
    // The lookup finds nothing: the contribution is hidden (or missing), so
    // the ownership 403 cannot fire and the answer cannot tell them apart.
    mockTx.contribution.findFirst.mockResolvedValue(null);

    await expect(fillRequest(ACTOR, 10, 5)).rejects.toEqual(
      expect.objectContaining({
        statusCode: 404,
        message: 'Contribution not found'
      })
    );
    expect(mockTx.contribution.findFirst).toHaveBeenCalledWith({
      where: { id: 5, ...contributionVisibleTo(ACTOR) },
      include: { release: true }
    });
    expect(mockTx.request.findFirst).not.toHaveBeenCalled();
    expect(mockTx.request.updateMany).not.toHaveBeenCalled();
  });

  it('keeps the ownership 403 for a visible contribution of another member', async () => {
    mockTx.contribution.findFirst.mockResolvedValue({
      id: 5,
      userId: ACTOR + 1,
      release: { communityId: 1, type: 'Music' }
    });

    await expect(fillRequest(ACTOR, 10, 5)).rejects.toEqual(
      expect.objectContaining({ statusCode: 403 })
    );
    expect(mockTx.request.updateMany).not.toHaveBeenCalled();
  });
});

describe('createRequest in a community the caller cannot reach', () => {
  it('answers the unknown-community 400 before any debit', async () => {
    mockTx.user.findUnique.mockResolvedValue({
      id: ACTOR,
      contributed: BigInt('1073741824'),
      consumed: 0n
    });
    mockTx.community.findFirst.mockResolvedValue(null);

    await expect(
      createRequest(ACTOR, {
        communityId: 3,
        type: ReleaseType.Music,
        title: 'T',
        description: 'D',
        image: undefined,
        bounty: MINIMUM_BOUNTY
      })
    ).rejects.toEqual(
      expect.objectContaining({
        statusCode: 400,
        message: 'communityId or an artist id names nothing'
      })
    );
    expect(mockTx.community.findFirst).toHaveBeenCalledWith({
      where: { id: 3, ...communityReadableWhere(ACTOR) },
      select: { id: true }
    });
    expect(mockTx.user.updateMany).not.toHaveBeenCalled();
    expect(mockTx.request.create).not.toHaveBeenCalled();
  });
});
