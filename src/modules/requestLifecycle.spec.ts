/**
 * Service-level unit tests for the requestLifecycle module.
 *
 * Prisma is mocked at the lib/prisma boundary so we can test business logic,
 * authorization rules, error paths, and transaction behavior without a real DB.
 */

import { ReleaseType, RequestStatus } from '@prisma/client';
import { AppError } from '../lib/errors';

// ─── Prisma mock ──────────────────────────────────────────────────────────────

const mockTx = {
  user: {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    update: jest.fn()
  },
  request: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn()
  },
  requestBounty: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn()
  },
  economyTransaction: { create: jest.fn() },
  requestAction: { create: jest.fn() },
  requestFill: { create: jest.fn() },
  contribution: { findUnique: jest.fn() },
  notification: { createMany: jest.fn() }
};

const mockTransaction = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    $transaction: mockTransaction,
    request: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn()
    },
    requestBounty: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn()
    },
    requestAction: {
      create: jest.fn(),
      findMany: jest.fn()
    },
    requestVote: {
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn()
    }
  }
}));

jest.mock('./config', () => ({
  economy: { minimumBounty: 104857600 }
}));

import {
  addBounty,
  createRequest,
  fillRequest,
  unfillRequest,
  deleteRequest,
  listRequests,
  MINIMUM_BOUNTY,
  serializeRequest,
  getRequestDetail,
  getBountyHistory,
  toggleVote,
  updateRequest
} from './requestLifecycle';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeUser = (overrides = {}) => ({
  id: 1,
  contributed: BigInt('1073741824'), // 1 GiB
  consumed: BigInt('0'),
  ...overrides
});

const makeRequest = (overrides = {}) => ({
  id: 10,
  communityId: 1,
  userId: 1,
  title: 'Test',
  description: 'Desc',
  type: 'Music',
  year: null,
  image: null,
  status: 'open',
  fillerId: null,
  filledAt: null,
  filledContributionId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  voteCount: 0,
  bounties: [
    {
      id: 1,
      requestId: 10,
      userId: 1,
      amount: BigInt('209715200'),
      createdAt: new Date()
    }
  ],
  ...overrides
});

const makeContribution = (overrides = {}) => ({
  id: 5,
  userId: 1,
  releaseId: 100,
  release: { id: 100, communityId: 1, type: 'Music' },
  ...overrides
});

beforeEach(() => {
  mockTransaction.mockImplementation(
    (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)
  );
});

// ─── serializeRequest ─────────────────────────────────────────────────────────

describe('serializeRequest', () => {
  it('sums bounty totals and stringifies individual amounts', () => {
    const result = serializeRequest({
      ...makeRequest(),
      bounties: [
        {
          id: 1,
          requestId: 10,
          userId: 1,
          amount: BigInt('104857600'),
          createdAt: new Date()
        },
        {
          id: 2,
          requestId: 10,
          userId: 2,
          amount: BigInt('52428800'),
          createdAt: new Date()
        }
      ]
    } as Parameters<typeof serializeRequest>[0]);

    expect(result.totalBounty).toBe('157286400');
    expect(result.bounties?.map((b) => b.amount)).toEqual([
      '104857600',
      '52428800'
    ]);
  });
});

// ─── createRequest ─────────────────────────────────────────────────────────────

describe('createRequest', () => {
  it('throws if bounty below minimum', async () => {
    await expect(
      createRequest(1, {
        communityId: 1,
        type: ReleaseType.Music,
        title: 'T',
        description: 'D',
        image: undefined,
        bounty: BigInt(1)
      })
    ).rejects.toThrow(AppError);
  });

  it('throws if user has insufficient balance', async () => {
    mockTx.user.findUnique.mockResolvedValue(
      makeUser({ contributed: BigInt(100), consumed: BigInt(100) })
    );
    await expect(
      createRequest(1, {
        communityId: 1,
        type: ReleaseType.Music,
        title: 'T',
        description: 'D',
        image: undefined,
        bounty: MINIMUM_BOUNTY
      })
    ).rejects.toThrow('Insufficient contributed balance');
  });

  it('creates request, ledger row, and audit action in one transaction', async () => {
    const user = makeUser();
    const created = makeRequest({
      bounties: [
        {
          id: 1,
          requestId: 10,
          userId: 1,
          amount: MINIMUM_BOUNTY,
          createdAt: new Date()
        }
      ],
      artists: []
    });

    mockTx.user.findUnique.mockResolvedValue(user);
    mockTx.user.update.mockResolvedValue(undefined);
    mockTx.request.create.mockResolvedValue(created);
    mockTx.economyTransaction.create.mockResolvedValue(undefined);
    mockTx.requestAction.create.mockResolvedValue(undefined);

    const result = await createRequest(1, {
      communityId: 1,
      type: ReleaseType.Music,
      title: 'My Album',
      description: 'Please',
      image: undefined,
      bounty: MINIMUM_BOUNTY
    });

    expect(mockTx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          consumed: { increment: MINIMUM_BOUNTY },
          ratio: expect.any(Number)
        })
      })
    );
    expect(mockTx.request.create).toHaveBeenCalled();
    expect(mockTx.economyTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contextId: created.id,
          reason: 'REQUEST_CREATE'
        })
      })
    );
    expect(mockTx.requestAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'CREATE' })
      })
    );
    expect(result.totalBounty).toBe(MINIMUM_BOUNTY.toString());
  });
});

// ─── addBounty ───────────────────────────────────────────────────────────────

describe('addBounty', () => {
  it('throws if the added bounty is below minimum', async () => {
    await expect(addBounty(1, 10, BigInt(1))).rejects.toThrow(AppError);
  });

  it('throws when request is missing or not open', async () => {
    mockTx.request.findUnique.mockResolvedValue(null);

    await expect(addBounty(1, 10, MINIMUM_BOUNTY)).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it('throws when user lacks contributed balance', async () => {
    mockTx.request.findUnique.mockResolvedValue(makeRequest());
    mockTx.user.findUnique.mockResolvedValue(
      makeUser({ contributed: BigInt(100), consumed: BigInt(100) })
    );

    await expect(addBounty(1, 10, MINIMUM_BOUNTY)).rejects.toMatchObject({
      statusCode: 400
    });
  });

  it('increments an existing bounty and records ledger/action rows', async () => {
    const updated = makeRequest({
      bounties: [
        {
          id: 3,
          requestId: 10,
          userId: 1,
          amount: BigInt('314572800'),
          createdAt: new Date(),
          user: { id: 1, username: 'testuser' }
        }
      ]
    });
    mockTx.request.findUnique
      .mockResolvedValueOnce(makeRequest())
      .mockResolvedValueOnce(updated);
    mockTx.user.findUnique.mockResolvedValue(makeUser());
    mockTx.user.update.mockResolvedValue(undefined);
    mockTx.economyTransaction.create.mockResolvedValue(undefined);
    mockTx.requestBounty.findUnique.mockResolvedValue({
      id: 3,
      requestId: 10,
      userId: 1,
      amount: BigInt('209715200'),
      createdAt: new Date()
    });
    mockTx.requestBounty.update.mockResolvedValue(undefined);
    mockTx.requestAction.create.mockResolvedValue(undefined);

    const result = await addBounty(1, 10, MINIMUM_BOUNTY);

    expect(mockTx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          consumed: { increment: MINIMUM_BOUNTY },
          ratio: expect.any(Number)
        })
      })
    );
    expect(mockTx.requestBounty.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { amount: { increment: MINIMUM_BOUNTY } }
    });
    expect(mockTx.economyTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reason: 'REQUEST_VOTE',
          amount: -MINIMUM_BOUNTY
        })
      })
    );
    expect(result.totalBounty).toBe('314572800');
  });

  it('creates a new bounty row when the user has not pledged before', async () => {
    const updated = makeRequest({
      bounties: [
        {
          id: 4,
          requestId: 10,
          userId: 2,
          amount: MINIMUM_BOUNTY,
          createdAt: new Date(),
          user: { id: 2, username: 'other' }
        }
      ]
    });
    mockTx.request.findUnique
      .mockResolvedValueOnce(makeRequest())
      .mockResolvedValueOnce(updated);
    mockTx.user.findUnique.mockResolvedValue(makeUser());
    mockTx.user.update.mockResolvedValue(undefined);
    mockTx.economyTransaction.create.mockResolvedValue(undefined);
    mockTx.requestBounty.findUnique.mockResolvedValue(null);
    mockTx.requestBounty.create.mockResolvedValue(undefined);
    mockTx.requestAction.create.mockResolvedValue(undefined);

    await addBounty(1, 10, MINIMUM_BOUNTY);

    expect(mockTx.requestBounty.create).toHaveBeenCalledWith({
      data: { requestId: 10, userId: 1, amount: MINIMUM_BOUNTY }
    });
  });
});

// ─── fillRequest ──────────────────────────────────────────────────────────────

describe('fillRequest', () => {
  it('throws 404 when contribution not found', async () => {
    mockTx.contribution.findUnique.mockResolvedValue(null);
    await expect(fillRequest(1, 10, 999)).rejects.toThrow(AppError);
  });

  it('throws 403 when caller does not own the contribution', async () => {
    mockTx.contribution.findUnique.mockResolvedValue(
      makeContribution({ userId: 99 }) // different user
    );
    await expect(fillRequest(1, 10, 5)).rejects.toMatchObject({
      statusCode: 403
    });
  });

  it('throws 404 when request not open', async () => {
    mockTx.contribution.findUnique.mockResolvedValue(makeContribution());
    mockTx.request.findUnique.mockResolvedValue(null);
    await expect(fillRequest(1, 10, 5)).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it('throws 400 when community does not match', async () => {
    mockTx.contribution.findUnique.mockResolvedValue(
      makeContribution({ release: { communityId: 99, type: 'Music' } })
    );
    mockTx.request.findUnique.mockResolvedValue(makeRequest());
    await expect(fillRequest(1, 10, 5)).rejects.toMatchObject({
      statusCode: 400
    });
  });

  it('throws 400 when type does not match', async () => {
    mockTx.contribution.findUnique.mockResolvedValue(
      makeContribution({ release: { communityId: 1, type: 'EBooks' } })
    );
    mockTx.request.findUnique.mockResolvedValue(makeRequest());
    await expect(fillRequest(1, 10, 5)).rejects.toMatchObject({
      statusCode: 400
    });
  });

  it('throws 400 if contribution already fills another request', async () => {
    mockTx.contribution.findUnique.mockResolvedValue(makeContribution());
    mockTx.request.findUnique.mockResolvedValue(makeRequest());
    mockTx.request.findFirst.mockResolvedValue({ id: 20 }); // already filling req #20
    await expect(fillRequest(1, 10, 5)).rejects.toMatchObject({
      statusCode: 400
    });
  });

  it('throws 409 when compare-and-swap finds 0 updated rows (concurrent fill)', async () => {
    mockTx.contribution.findUnique.mockResolvedValue(makeContribution());
    mockTx.request.findUnique.mockResolvedValue(makeRequest());
    mockTx.request.findFirst.mockResolvedValue(null);
    mockTx.request.updateMany.mockResolvedValue({ count: 0 }); // lost the race
    await expect(fillRequest(1, 10, 5)).rejects.toMatchObject({
      statusCode: 409
    });
  });

  it('awards bounty to filler and records fill + audit on success', async () => {
    const bountyAmount = BigInt('209715200');
    mockTx.contribution.findUnique.mockResolvedValue(makeContribution());
    mockTx.request.findUnique
      .mockResolvedValueOnce(makeRequest()) // pre-validation fetch
      .mockResolvedValueOnce(makeRequest({ status: 'filled', fillerId: 1 })); // final fetch
    mockTx.request.findFirst.mockResolvedValue(null);
    mockTx.request.updateMany.mockResolvedValue({ count: 1 });
    mockTx.user.findUniqueOrThrow.mockResolvedValue({
      consumed: BigInt(0),
      contributed: BigInt('1073741824')
    });
    mockTx.user.update.mockResolvedValue(undefined);
    mockTx.economyTransaction.create.mockResolvedValue(undefined);
    mockTx.requestFill.create.mockResolvedValue(undefined);
    mockTx.requestAction.create.mockResolvedValue(undefined);

    await fillRequest(1, 10, 5);

    expect(mockTx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contributed: { increment: bountyAmount },
          ratio: expect.any(Number)
        })
      })
    );
    expect(mockTx.requestFill.create).toHaveBeenCalled();
    expect(mockTx.requestAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'FILL' })
      })
    );
  });

  it('notifies requester and bounty holders, excluding the filler', async () => {
    const requestWithBounties = makeRequest({
      userId: 2, // requester
      bounties: [
        {
          id: 1,
          requestId: 10,
          userId: 2,
          amount: BigInt('209715200'),
          createdAt: new Date()
        },
        {
          id: 2,
          requestId: 10,
          userId: 3,
          amount: BigInt('104857600'),
          createdAt: new Date()
        }
      ]
    });
    mockTx.contribution.findUnique.mockResolvedValue(makeContribution());
    mockTx.request.findUnique
      .mockResolvedValueOnce(requestWithBounties)
      .mockResolvedValueOnce({
        ...requestWithBounties,
        status: 'filled',
        fillerId: 1
      });
    mockTx.request.findFirst.mockResolvedValue(null);
    mockTx.request.updateMany.mockResolvedValue({ count: 1 });
    mockTx.user.findUniqueOrThrow.mockResolvedValue({
      consumed: BigInt(0),
      contributed: BigInt('1073741824')
    });
    mockTx.user.update.mockResolvedValue(undefined);
    mockTx.economyTransaction.create.mockResolvedValue(undefined);
    mockTx.requestFill.create.mockResolvedValue(undefined);
    mockTx.requestAction.create.mockResolvedValue(undefined);
    mockTx.notification.createMany.mockResolvedValue({ count: 2 });

    await fillRequest(1, 10, 5); // filler = userId 1

    expect(mockTx.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ userId: 2, type: 'request_filled' }),
          expect.objectContaining({ userId: 3, type: 'request_filled' })
        ]),
        skipDuplicates: true
      })
    );
    const notifData = (mockTx.notification.createMany as jest.Mock).mock
      .calls[0][0].data as { userId: number }[];
    expect(notifData.map((d) => d.userId)).not.toContain(1); // filler excluded
  });

  it('emits no notification when filler is the only interested party', async () => {
    const selfRequest = makeRequest({
      userId: 1,
      bounties: [
        {
          id: 1,
          requestId: 10,
          userId: 1,
          amount: BigInt('209715200'),
          createdAt: new Date()
        }
      ]
    });
    mockTx.contribution.findUnique.mockResolvedValue(makeContribution());
    mockTx.request.findUnique
      .mockResolvedValueOnce(selfRequest)
      .mockResolvedValueOnce({ ...selfRequest, status: 'filled', fillerId: 1 });
    mockTx.request.findFirst.mockResolvedValue(null);
    mockTx.request.updateMany.mockResolvedValue({ count: 1 });
    mockTx.user.findUniqueOrThrow.mockResolvedValue({
      consumed: BigInt(0),
      contributed: BigInt('1073741824')
    });
    mockTx.user.update.mockResolvedValue(undefined);
    mockTx.economyTransaction.create.mockResolvedValue(undefined);
    mockTx.requestFill.create.mockResolvedValue(undefined);
    mockTx.requestAction.create.mockResolvedValue(undefined);

    await fillRequest(1, 10, 5); // filler = userId 1 = requester

    expect(mockTx.notification.createMany).not.toHaveBeenCalled();
  });
});

// ─── unfillRequest ─────────────────────────────────────────────────────────────

describe('unfillRequest', () => {
  it('throws 404 if request is not found', async () => {
    mockTx.request.findUnique.mockResolvedValue(null);
    await expect(
      unfillRequest({
        requestId: 10,
        actorId: 99,
        canModerateRequests: true,
        reason: 'reason'
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 422 if request is not filled', async () => {
    mockTx.request.findUnique.mockResolvedValue(
      makeRequest({ status: 'open', userId: 99, fillerId: null })
    );
    await expect(
      unfillRequest({ requestId: 10, actorId: 99, canModerateRequests: true })
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('throws 403 when caller is not owner, filler, or moderator', async () => {
    mockTx.request.findUnique.mockResolvedValue(
      makeRequest({ status: 'filled', userId: 88, fillerId: 77 })
    );
    await expect(
      unfillRequest({ requestId: 10, actorId: 1, canModerateRequests: false })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('allows the request owner to unfill', async () => {
    const filledReq = makeRequest({
      status: 'filled',
      userId: 1,
      fillerId: 77
    });
    const openReq = { ...filledReq, status: 'open', fillerId: null };
    mockTx.request.findUnique
      .mockResolvedValueOnce(filledReq)
      .mockResolvedValueOnce(openReq);
    mockTx.user.findUniqueOrThrow.mockResolvedValue({
      consumed: BigInt(0),
      contributed: BigInt('209715200')
    });
    mockTx.user.update.mockResolvedValue(undefined);
    mockTx.economyTransaction.create.mockResolvedValue(undefined);
    mockTx.request.update.mockResolvedValue(undefined);
    mockTx.requestAction.create.mockResolvedValue(undefined);

    await expect(
      unfillRequest({ requestId: 10, actorId: 1, canModerateRequests: false })
    ).resolves.toBeDefined();
  });

  it('allows the filler to unfill their own fill', async () => {
    const filledReq = makeRequest({
      status: 'filled',
      userId: 88,
      fillerId: 1
    });
    const openReq = { ...filledReq, status: 'open', fillerId: null };
    mockTx.request.findUnique
      .mockResolvedValueOnce(filledReq)
      .mockResolvedValueOnce(openReq);
    mockTx.user.findUniqueOrThrow.mockResolvedValue({
      consumed: BigInt(0),
      contributed: BigInt('209715200')
    });
    mockTx.user.update.mockResolvedValue(undefined);
    mockTx.economyTransaction.create.mockResolvedValue(undefined);
    mockTx.request.update.mockResolvedValue(undefined);
    mockTx.requestAction.create.mockResolvedValue(undefined);

    await expect(
      unfillRequest({ requestId: 10, actorId: 1, canModerateRequests: false })
    ).resolves.toBeDefined();
  });

  it('allows a moderator to unfill any filled request', async () => {
    const filledReq = makeRequest({
      status: 'filled',
      userId: 88,
      fillerId: 77
    });
    const openReq = { ...filledReq, status: 'open', fillerId: null };
    mockTx.request.findUnique
      .mockResolvedValueOnce(filledReq)
      .mockResolvedValueOnce(openReq);
    mockTx.user.findUniqueOrThrow.mockResolvedValue({
      consumed: BigInt(0),
      contributed: BigInt('209715200')
    });
    mockTx.user.update.mockResolvedValue(undefined);
    mockTx.economyTransaction.create.mockResolvedValue(undefined);
    mockTx.request.update.mockResolvedValue(undefined);
    mockTx.requestAction.create.mockResolvedValue(undefined);

    await expect(
      unfillRequest({ requestId: 10, actorId: 99, canModerateRequests: true })
    ).resolves.toBeDefined();
  });

  it('claws back bounty from filler and records audit with actorId', async () => {
    const filledReq = makeRequest({
      status: 'filled',
      userId: 88,
      fillerId: 7,
      bounties: [
        {
          id: 1,
          requestId: 10,
          userId: 1,
          amount: BigInt('209715200'),
          createdAt: new Date()
        }
      ]
    });
    mockTx.request.findUnique
      .mockResolvedValueOnce(filledReq)
      .mockResolvedValueOnce({ ...filledReq, status: 'open', fillerId: null });
    mockTx.user.findUniqueOrThrow.mockResolvedValue({
      consumed: BigInt(0),
      contributed: BigInt('209715200')
    });
    mockTx.user.update.mockResolvedValue(undefined);
    mockTx.economyTransaction.create.mockResolvedValue(undefined);
    mockTx.request.update.mockResolvedValue(undefined);
    mockTx.requestAction.create.mockResolvedValue(undefined);

    await unfillRequest({
      requestId: 10,
      actorId: 99,
      canModerateRequests: true,
      reason: 'Incorrect fill'
    });

    expect(mockTx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7 },
        data: expect.objectContaining({
          contributed: { decrement: BigInt('209715200') },
          ratio: expect.any(Number)
        })
      })
    );
    expect(mockTx.economyTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reason: 'REQUEST_UNFILL',
          actorUserId: 99
        })
      })
    );
    expect(mockTx.requestAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 99,
          action: 'UNFILL',
          metadata: expect.objectContaining({ reason: 'Incorrect fill' })
        })
      })
    );
  });
});

// ─── deleteRequest ─────────────────────────────────────────────────────────────

describe('deleteRequest', () => {
  it('throws 404 when request not found', async () => {
    mockTx.request.findUnique.mockResolvedValue(null);
    await expect(
      deleteRequest({ requestId: 10, actorId: 1, canModerateRequests: false })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 403 when non-owner non-moderator tries to delete', async () => {
    mockTx.request.findUnique.mockResolvedValue(makeRequest({ userId: 99 }));
    await expect(
      deleteRequest({ requestId: 10, actorId: 1, canModerateRequests: false })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('throws 403 when owner tries to delete a filled request without moderation', async () => {
    mockTx.request.findUnique.mockResolvedValue(
      makeRequest({ userId: 1, status: 'filled' })
    );
    await expect(
      deleteRequest({ requestId: 10, actorId: 1, canModerateRequests: false })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('allows moderator to delete a filled request without refunding', async () => {
    mockTx.request.findUnique.mockResolvedValue(
      makeRequest({ userId: 99, status: 'filled', bounties: [] })
    );
    mockTx.request.update.mockResolvedValue(undefined);
    mockTx.requestAction.create.mockResolvedValue(undefined);

    await deleteRequest({
      requestId: 10,
      actorId: 1,
      canModerateRequests: true
    });

    expect(mockTx.user.update).not.toHaveBeenCalled();
    expect(mockTx.economyTransaction.create).not.toHaveBeenCalled();
    expect(mockTx.requestAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'DELETE' })
      })
    );
  });

  it('refunds all bounties when deleting an open request', async () => {
    const bounties = [
      { id: 1, userId: 1, amount: BigInt('104857600'), requestId: 10 },
      { id: 2, userId: 2, amount: BigInt('52428800'), requestId: 10 }
    ];
    mockTx.request.findUnique.mockResolvedValue(makeRequest({ bounties }));
    mockTx.user.findUniqueOrThrow
      .mockResolvedValueOnce({
        consumed: BigInt('104857600'),
        contributed: BigInt('1073741824')
      })
      .mockResolvedValueOnce({
        consumed: BigInt('52428800'),
        contributed: BigInt('1073741824')
      });
    mockTx.user.update.mockResolvedValue(undefined);
    mockTx.economyTransaction.create.mockResolvedValue(undefined);
    mockTx.request.update.mockResolvedValue(undefined);
    mockTx.requestAction.create.mockResolvedValue(undefined);

    await deleteRequest({
      requestId: 10,
      actorId: 1,
      canModerateRequests: false
    });

    expect(mockTx.user.update).toHaveBeenCalledTimes(2);
    expect(mockTx.user.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({
          consumed: { decrement: BigInt('104857600') },
          ratio: expect.any(Number)
        })
      })
    );
    expect(mockTx.user.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 2 },
        data: expect.objectContaining({
          consumed: { decrement: BigInt('52428800') },
          ratio: expect.any(Number)
        })
      })
    );
    expect(mockTx.economyTransaction.create).toHaveBeenCalledTimes(2);
    expect(
      (
        mockTx.economyTransaction.create.mock.calls as [
          { data: Record<string, unknown> }
        ][]
      ).every(([arg]) => arg.data.reason === 'REQUEST_REFUND')
    ).toBe(true);
  });

  it('does not refund bounties when moderator deletes a filled request', async () => {
    mockTx.request.findUnique.mockResolvedValue(
      makeRequest({ status: 'filled', bounties: [] })
    );
    mockTx.request.update.mockResolvedValue(undefined);
    mockTx.requestAction.create.mockResolvedValue(undefined);

    await deleteRequest({
      requestId: 10,
      actorId: 99,
      canModerateRequests: true
    });

    expect(mockTx.user.update).not.toHaveBeenCalled();
    expect(mockTx.economyTransaction.create).not.toHaveBeenCalled();
    expect(mockTx.requestAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'DELETE' })
      })
    );
  });
});

// ─── getRequestDetail ─────────────────────────────────────────────────────────

describe('getRequestDetail', () => {
  it('throws 404 when request is not found', async () => {
    const { prisma } = await import('../lib/prisma');
    (prisma.request.findUnique as jest.Mock).mockResolvedValueOnce(null);

    await expect(getRequestDetail(999)).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it('returns serialized request with voteCount and votes', async () => {
    const { prisma } = await import('../lib/prisma');
    const rawRequest = {
      ...makeRequest({
        bounties: [
          {
            id: 1,
            requestId: 10,
            userId: 1,
            amount: BigInt('104857600'),
            createdAt: new Date(),
            user: { id: 1, username: 'testuser' }
          }
        ]
      }),
      user: { id: 1, username: 'testuser' },
      filler: null,
      community: { id: 1, name: 'Jazz' },
      artists: [],
      filledContribution: null,
      votes: [{ userId: 1 }],
      voteCount: 1
    };
    (prisma.request.findUnique as jest.Mock).mockResolvedValueOnce(rawRequest);

    const result = await getRequestDetail(10);

    expect(result.totalBounty).toBe('104857600');
    expect(result.voteCount).toBe(1);
    expect(result.votes).toEqual([{ userId: 1 }]);
  });
});

// ─── getBountyHistory ─────────────────────────────────────────────────────────

describe('getBountyHistory', () => {
  it('throws 404 when request is not found', async () => {
    const { prisma } = await import('../lib/prisma');
    (prisma.request.findUnique as jest.Mock).mockResolvedValueOnce(null);

    await expect(getBountyHistory(999)).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it('returns bounties and actions for the request', async () => {
    const { prisma } = await import('../lib/prisma');
    (prisma.request.findUnique as jest.Mock).mockResolvedValueOnce({ id: 10 });
    (prisma.requestBounty.findMany as jest.Mock).mockResolvedValueOnce([
      {
        id: 1,
        requestId: 10,
        userId: 1,
        amount: BigInt('104857600'),
        createdAt: new Date(),
        user: { id: 1, username: 'testuser' }
      }
    ]);
    (prisma.requestAction.findMany as jest.Mock).mockResolvedValueOnce([]);

    const result = await getBountyHistory(10);

    expect(result.bounties).toHaveLength(1);
    expect(result.actions).toHaveLength(0);
  });
});

// ─── toggleVote ───────────────────────────────────────────────────────────────

describe('toggleVote', () => {
  it('throws 404 when request is not found', async () => {
    const { prisma } = await import('../lib/prisma');
    (prisma.request.findUnique as jest.Mock).mockResolvedValueOnce(null);

    await expect(toggleVote(999, 1)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('adds a vote and returns { voted: true } when no existing vote', async () => {
    const { prisma } = await import('../lib/prisma');
    (prisma.request.findUnique as jest.Mock).mockResolvedValueOnce({ id: 10 });
    (prisma.requestVote.findUnique as jest.Mock).mockResolvedValueOnce(null);
    (prisma.requestVote.create as jest.Mock).mockReturnValue({} as never);
    (prisma.request.update as jest.Mock).mockReturnValue({} as never);
    mockTransaction.mockResolvedValueOnce([{}, {}]);

    const result = await toggleVote(10, 1);

    expect(result).toEqual({ voted: true });
  });

  it('removes a vote and returns { voted: false } when vote exists', async () => {
    const { prisma } = await import('../lib/prisma');
    (prisma.request.findUnique as jest.Mock).mockResolvedValueOnce({ id: 10 });
    (prisma.requestVote.findUnique as jest.Mock).mockResolvedValueOnce({
      requestId: 10,
      userId: 1
    });
    (prisma.requestVote.delete as jest.Mock).mockReturnValue({} as never);
    (prisma.request.update as jest.Mock).mockReturnValue({} as never);
    mockTransaction.mockResolvedValueOnce([{}, {}]);

    const result = await toggleVote(10, 1);

    expect(result).toEqual({ voted: false });
  });
});

// ─── updateRequest ────────────────────────────────────────────────────────────

describe('updateRequest', () => {
  it('throws 404 when request is not found', async () => {
    const { prisma } = await import('../lib/prisma');
    (prisma.request.findUnique as jest.Mock).mockResolvedValueOnce(null);

    await expect(
      updateRequest({
        requestId: 10,
        actorId: 1,
        canModerateRequests: false,
        input: { image: undefined }
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 422 when request is not open', async () => {
    const { prisma } = await import('../lib/prisma');
    (prisma.request.findUnique as jest.Mock).mockResolvedValueOnce({
      userId: 1,
      status: 'filled'
    });

    await expect(
      updateRequest({
        requestId: 10,
        actorId: 1,
        canModerateRequests: false,
        input: { image: undefined }
      })
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('throws 403 when non-owner non-moderator edits', async () => {
    const { prisma } = await import('../lib/prisma');
    (prisma.request.findUnique as jest.Mock).mockResolvedValueOnce({
      userId: 99,
      status: 'open'
    });

    await expect(
      updateRequest({
        requestId: 10,
        actorId: 1,
        canModerateRequests: false,
        input: { image: undefined }
      })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('allows owner to update an open request', async () => {
    const { prisma } = await import('../lib/prisma');
    (prisma.request.findUnique as jest.Mock).mockResolvedValueOnce({
      userId: 1,
      status: 'open'
    });
    (prisma.request.update as jest.Mock).mockResolvedValueOnce({
      ...makeRequest({ title: 'Updated', userId: 1 }),
      bounties: [],
      user: { id: 1, username: 'testuser' }
    });

    const result = await updateRequest({
      requestId: 10,
      actorId: 1,
      canModerateRequests: false,
      input: { title: 'Updated', image: undefined }
    });

    expect(result.title).toBe('Updated');
  });

  it('allows moderator to update any open request', async () => {
    const { prisma } = await import('../lib/prisma');
    (prisma.request.findUnique as jest.Mock).mockResolvedValueOnce({
      userId: 99,
      status: 'open'
    });
    (prisma.request.update as jest.Mock).mockResolvedValueOnce({
      ...makeRequest({ title: 'Mod Edit', userId: 99 }),
      bounties: [],
      user: { id: 99, username: 'other' }
    });

    const result = await updateRequest({
      requestId: 10,
      actorId: 1,
      canModerateRequests: true,
      input: { title: 'Mod Edit', image: undefined }
    });

    expect(result.title).toBe('Mod Edit');
  });

  it('shapes update data correctly, excluding undefined fields', async () => {
    const { prisma } = await import('../lib/prisma');
    (prisma.request.findUnique as jest.Mock).mockResolvedValueOnce({
      userId: 1,
      status: 'open'
    });
    (prisma.request.update as jest.Mock).mockResolvedValueOnce({
      ...makeRequest({ title: 'New Title', image: null, userId: 1 }),
      bounties: [],
      user: { id: 1, username: 'testuser' }
    });

    await updateRequest({
      requestId: 10,
      actorId: 1,
      canModerateRequests: false,
      input: { title: 'New Title', image: null as string | null | undefined }
    });

    expect(prisma.request.update as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 10 },
        data: { title: 'New Title', image: null }
      })
    );
  });
});

// ─── listRequests ─────────────────────────────────────────────────────────────

describe('listRequests', () => {
  it('returns paginated results with serialized BigInt', async () => {
    const { prisma } = await import('../lib/prisma');
    (prisma.request.findMany as jest.Mock).mockResolvedValue([
      makeRequest({
        bounties: [
          {
            id: 1,
            requestId: 10,
            userId: 1,
            amount: BigInt('209715200'),
            createdAt: new Date()
          }
        ]
      })
    ]);
    (prisma.request.count as jest.Mock).mockResolvedValue(1);

    const result = await listRequests({
      communityId: 1,
      status: RequestStatus.open
    });

    expect(result.data[0].totalBounty).toBe('209715200');
    expect(typeof result.data[0].totalBounty).toBe('string');
    expect(prisma.request.findMany as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ communityId: 1, status: 'open' })
      })
    );
  });
});
