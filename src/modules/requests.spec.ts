/**
 * Service-level unit tests for the requests module.
 *
 * Prisma is mocked at the lib/prisma boundary so we can test business logic,
 * error paths, and transaction behavior without a real database.
 */

import { ReleaseType, RequestStatus } from '@prisma/client';
import { AppError } from '../lib/errors';

// ─── Prisma mock ──────────────────────────────────────────────────────────────

const mockTx = {
  user: { findUnique: jest.fn(), update: jest.fn() },
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
  contribution: { findUnique: jest.fn() }
};

jest.mock('../lib/prisma', () => ({
  prisma: {
    $transaction: jest.fn((cb: (tx: typeof mockTx) => Promise<unknown>) =>
      cb(mockTx)
    ),
    request: {
      findMany: jest.fn(),
      count: jest.fn()
    }
  }
}));

jest.mock('./config', () => ({
  economy: { minimumBounty: 104857600 }
}));

import {
  createRequest,
  fillRequest,
  unfillRequest,
  deleteRequest,
  listRequests,
  MINIMUM_BOUNTY
} from './requests';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeUser = (overrides = {}) => ({
  id: 1,
  uploaded: BigInt('1073741824'), // 1 GiB
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

// ─── createRequest ─────────────────────────────────────────────────────────────

describe('createRequest', () => {
  beforeEach(() => jest.clearAllMocks());

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
    mockTx.user.findUnique.mockResolvedValue(makeUser({ uploaded: BigInt(0) }));
    await expect(
      createRequest(1, {
        communityId: 1,
        type: ReleaseType.Music,
        title: 'T',
        description: 'D',
        image: undefined,
        bounty: MINIMUM_BOUNTY
      })
    ).rejects.toThrow('Insufficient upload balance');
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

// ─── fillRequest ──────────────────────────────────────────────────────────────

describe('fillRequest', () => {
  beforeEach(() => jest.clearAllMocks());

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
    mockTx.user.update.mockResolvedValue(undefined);
    mockTx.economyTransaction.create.mockResolvedValue(undefined);
    mockTx.requestFill.create.mockResolvedValue(undefined);
    mockTx.requestAction.create.mockResolvedValue(undefined);

    await fillRequest(1, 10, 5);

    expect(mockTx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { uploaded: { increment: bountyAmount } }
      })
    );
    expect(mockTx.requestFill.create).toHaveBeenCalled();
    expect(mockTx.requestAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'FILL' })
      })
    );
  });
});

// ─── unfillRequest ─────────────────────────────────────────────────────────────

describe('unfillRequest', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws 404 if request is not filled', async () => {
    mockTx.request.findUnique.mockResolvedValue(null);
    await expect(unfillRequest(99, 10, 'reason')).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it('claws back bounty from filler and records audit with moderatorId', async () => {
    const filledReq = makeRequest({
      status: 'filled',
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
      .mockResolvedValueOnce(filledReq) // initial fetch
      .mockResolvedValueOnce({ ...filledReq, status: 'open', fillerId: null }); // final fetch
    mockTx.user.update.mockResolvedValue(undefined);
    mockTx.economyTransaction.create.mockResolvedValue(undefined);
    mockTx.request.update.mockResolvedValue(undefined);
    mockTx.requestAction.create.mockResolvedValue(undefined);

    await unfillRequest(99, 10, 'Incorrect fill');

    expect(mockTx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7 },
        data: { uploaded: { decrement: BigInt('209715200') } }
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
  beforeEach(() => jest.clearAllMocks());

  it('throws 404 when request not found', async () => {
    mockTx.request.findUnique.mockResolvedValue(null);
    await expect(deleteRequest(1, 10, false)).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it('throws 403 when non-staff tries to delete a filled request', async () => {
    mockTx.request.findUnique.mockResolvedValue(
      makeRequest({ status: 'filled' })
    );
    await expect(deleteRequest(1, 10, false)).rejects.toMatchObject({
      statusCode: 403
    });
  });

  it('refunds all bounties when deleting an open request', async () => {
    const bounties = [
      { id: 1, userId: 1, amount: BigInt('104857600'), requestId: 10 },
      { id: 2, userId: 2, amount: BigInt('52428800'), requestId: 10 }
    ];
    mockTx.request.findUnique.mockResolvedValue(makeRequest({ bounties }));
    mockTx.user.update.mockResolvedValue(undefined);
    mockTx.economyTransaction.create.mockResolvedValue(undefined);
    mockTx.request.update.mockResolvedValue(undefined);
    mockTx.requestAction.create.mockResolvedValue(undefined);

    await deleteRequest(1, 10, false);

    expect(mockTx.user.update).toHaveBeenCalledTimes(2);
    expect(mockTx.economyTransaction.create).toHaveBeenCalledTimes(2);
    expect(
      (
        mockTx.economyTransaction.create.mock.calls as [
          { data: Record<string, unknown> }
        ][]
      ).every(([arg]) => arg.data.reason === 'REQUEST_REFUND')
    ).toBe(true);
  });

  it('does not refund bounties when staff deletes a filled request', async () => {
    mockTx.request.findUnique.mockResolvedValue(
      makeRequest({ status: 'filled' })
    );
    mockTx.request.update.mockResolvedValue(undefined);
    mockTx.requestAction.create.mockResolvedValue(undefined);

    await deleteRequest(99, 10, true); // isStaff = true

    expect(mockTx.user.update).not.toHaveBeenCalled();
    expect(mockTx.economyTransaction.create).not.toHaveBeenCalled();
    expect(mockTx.requestAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'DELETE' })
      })
    );
  });
});

// ─── listRequests ─────────────────────────────────────────────────────────────

describe('listRequests', () => {
  beforeEach(() => jest.clearAllMocks());

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
