/**
 * Balance races in the request lifecycle (#767, an instance of #766).
 *
 * These pin the structure that makes each money move safe under concurrency:
 * a claim is the first write, a lost claim writes nothing, bounties are read
 * after the claim, and debits are a snapshot compare-and-swap. The real-DB
 * evidence is in integration/requests.races.integration.ts.
 */

import { AppError } from '../lib/errors';
import { ReleaseType } from '@prisma/client';

const mockTx = {
  user: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  request: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn()
  },
  requestBounty: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn()
  },
  economyTransaction: { create: jest.fn() },
  requestAction: { create: jest.fn() },
  requestFill: { create: jest.fn(), findFirst: jest.fn() },
  contribution: { findUnique: jest.fn() },
  community: { findFirst: jest.fn() },
  notification: { createMany: jest.fn() }
};

const mockTransaction = jest.fn();

jest.mock('./notificationAccess', () => ({
  recipientsWhoCanSee: async (
    _tx: unknown,
    _page: unknown,
    _pageId: unknown,
    userIds: number[]
  ) => userIds
}));

jest.mock('../lib/prisma', () => ({
  prisma: { $transaction: mockTransaction }
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
  MINIMUM_BOUNTY,
  unfillRequest
} from './requestLifecycle';

const balance = { contributed: BigInt('1073741824'), consumed: BigInt(0) };

const makeRequest = (overrides = {}) => ({
  id: 10,
  communityId: 1,
  userId: 1,
  type: 'Music',
  status: 'open',
  fillerId: null,
  deletedAt: null,
  bounties: [],
  ...overrides
});

const bounty = (userId: number, amount: bigint) => ({
  id: userId,
  requestId: 10,
  userId,
  amount,
  createdAt: new Date()
});

/** Every call order of the given mocks, flattened. */
const callOrders = (...mocks: jest.Mock[]) =>
  mocks.flatMap((m) => m.mock.invocationCallOrder);

beforeEach(() => {
  mockTransaction.mockImplementation(
    (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)
  );
  mockTx.request.updateMany.mockResolvedValue({ count: 1 });
  mockTx.user.updateMany.mockResolvedValue({ count: 1 });
  mockTx.user.findUnique.mockResolvedValue({ id: 1, ...balance });
  mockTx.requestBounty.findMany.mockResolvedValue([]);
  mockTx.request.findFirst.mockResolvedValue({ id: 10 });
  mockTx.community.findFirst.mockResolvedValue({ id: 1 });
});

describe('createRequest', () => {
  const input = {
    communityId: 1,
    type: ReleaseType.Music,
    title: 'T',
    description: 'D',
    image: undefined,
    bounty: MINIMUM_BOUNTY
  };

  it('debits with a snapshot compare-and-swap on both balance columns', async () => {
    mockTx.request.create.mockResolvedValue({
      ...makeRequest(),
      artists: []
    });
    await createRequest(1, input);
    expect(mockTx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 1, ...balance },
      data: { consumed: { increment: MINIMUM_BOUNTY } }
    });
  });

  it('answers 409 and creates nothing when the balance moved since the read', async () => {
    mockTx.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(createRequest(1, input)).rejects.toMatchObject({
      statusCode: 409
    });
    expect(mockTx.request.create).not.toHaveBeenCalled();
  });
});

describe('addBounty', () => {
  it('claims the open request row before debiting', async () => {
    mockTx.request.findUnique.mockResolvedValue(makeRequest());
    mockTx.requestBounty.findUnique.mockResolvedValue(null);

    await addBounty(1, 10, MINIMUM_BOUNTY);

    expect(mockTx.request.updateMany).toHaveBeenCalledWith({
      where: { id: 10, status: 'open', deletedAt: null },
      data: { updatedAt: expect.any(Date) }
    });
    const [claim] = mockTx.request.updateMany.mock.invocationCallOrder;
    const writes = callOrders(
      mockTx.user.updateMany,
      mockTx.economyTransaction.create,
      mockTx.requestBounty.create
    );
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every((o) => o > claim)).toBe(true);
    expect(mockTx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 1, ...balance },
      data: { consumed: { increment: MINIMUM_BOUNTY } }
    });
  });

  it('answers 404 and moves no money when a fill or delete holds the claim', async () => {
    mockTx.request.updateMany.mockResolvedValue({ count: 0 });
    await expect(addBounty(1, 10, MINIMUM_BOUNTY)).rejects.toMatchObject({
      statusCode: 404
    });
    expect(mockTx.user.updateMany).not.toHaveBeenCalled();
    expect(mockTx.economyTransaction.create).not.toHaveBeenCalled();
  });

  it('answers 409 when the balance moved since the read', async () => {
    mockTx.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(addBounty(1, 10, MINIMUM_BOUNTY)).rejects.toMatchObject({
      statusCode: 409
    });
    expect(mockTx.requestBounty.create).not.toHaveBeenCalled();
  });
});

describe('fillRequest', () => {
  it('pays the bounties read after its claim, not those of the pre-read', async () => {
    const late = BigInt('314572800');
    mockTx.contribution.findUnique.mockResolvedValue({
      id: 5,
      userId: 1,
      release: { communityId: 1, type: 'Music' }
    });
    mockTx.request.findFirst.mockResolvedValueOnce(makeRequest());
    mockTx.request.findFirst.mockResolvedValue(null);
    mockTx.request.findUnique.mockResolvedValue(makeRequest());
    mockTx.requestBounty.findMany.mockResolvedValue([bounty(2, late)]);

    await fillRequest(1, 10, 5);

    const [claim] = mockTx.request.updateMany.mock.invocationCallOrder;
    const [read] = mockTx.requestBounty.findMany.mock.invocationCallOrder;
    expect(read).toBeGreaterThan(claim);
    expect(mockTx.user.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { contributed: { increment: late } }
    });
    expect(mockTx.requestFill.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ awardedAmount: late })
    });
  });
});

describe('unfillRequest', () => {
  const filled = () => makeRequest({ status: 'filled', fillerId: 7 });
  const unfill = () =>
    unfillRequest({ requestId: 10, actorId: 99, canModerateRequests: true });

  beforeEach(() => {
    mockTx.request.findFirst.mockResolvedValue(filled());
    mockTx.request.findUnique.mockResolvedValue(filled());
  });

  it('claims with the filler it read pinned, before any money moves', async () => {
    mockTx.requestFill.findFirst.mockResolvedValue({ awardedAmount: 100n });

    await unfill();

    expect(mockTx.request.updateMany).toHaveBeenCalledWith({
      where: { id: 10, status: 'filled', deletedAt: null, fillerId: 7 },
      data: {
        status: 'open',
        fillerId: null,
        filledAt: null,
        filledContributionId: null
      }
    });
    const [claim] = mockTx.request.updateMany.mock.invocationCallOrder;
    const money = callOrders(
      mockTx.user.updateMany,
      mockTx.economyTransaction.create
    );
    expect(money).toHaveLength(2);
    expect(money.every((o) => o > claim)).toBe(true);
  });

  it('answers 422 and moves no money when a concurrent unfill claimed first', async () => {
    mockTx.request.updateMany.mockResolvedValue({ count: 0 });
    await expect(unfill()).rejects.toMatchObject({ statusCode: 422 });
    expect(mockTx.user.updateMany).not.toHaveBeenCalled();
    expect(mockTx.economyTransaction.create).not.toHaveBeenCalled();
  });

  it("claws back the latest fill's awarded amount, not the bounty total", async () => {
    mockTx.request.findFirst.mockResolvedValue(
      makeRequest({
        status: 'filled',
        fillerId: 7,
        bounties: [bounty(2, 500n)]
      })
    );
    mockTx.requestFill.findFirst.mockResolvedValue({ awardedAmount: 300n });

    await unfill();

    expect(mockTx.requestFill.findFirst).toHaveBeenCalledWith({
      where: { requestId: 10, fillerId: 7 },
      orderBy: { id: 'desc' }
    });
    expect(mockTx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 7, contributed: { gte: 300n } },
      data: { contributed: { decrement: 300n } }
    });
    expect(mockTx.economyTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 7, amount: -300n })
    });
  });

  it('moves no money when the fill was awarded nothing', async () => {
    mockTx.requestFill.findFirst.mockResolvedValue({ awardedAmount: 0n });
    await unfill();
    expect(mockTx.user.updateMany).not.toHaveBeenCalled();
    expect(mockTx.economyTransaction.create).not.toHaveBeenCalled();
  });

  it('answers 500 when a filled request has no fill record', async () => {
    mockTx.requestFill.findFirst.mockResolvedValue(null);
    const err = await unfill().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ statusCode: 500 });
  });
});

describe('deleteRequest', () => {
  const del = () =>
    deleteRequest({ requestId: 10, actorId: 1, canModerateRequests: true });

  it('claims with the status it read pinned, then refunds the bounties read after', async () => {
    mockTx.request.findFirst.mockResolvedValue(makeRequest());
    mockTx.requestBounty.findMany.mockResolvedValue([bounty(2, 50n)]);

    await del();

    expect(mockTx.request.updateMany).toHaveBeenCalledWith({
      where: { id: 10, deletedAt: null, status: 'open' },
      data: { deletedAt: expect.any(Date) }
    });
    const [claim] = mockTx.request.updateMany.mock.invocationCallOrder;
    const [read] = mockTx.requestBounty.findMany.mock.invocationCallOrder;
    expect(read).toBeGreaterThan(claim);
    expect(mockTx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 2, consumed: { gte: 50n } },
      data: { consumed: { decrement: 50n } }
    });
    expect(mockTx.requestAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: { wasStatus: 'open', refundedCount: 1 }
      })
    });
  });

  it('answers 404 and refunds nothing when a concurrent delete or fill claimed first', async () => {
    mockTx.request.findFirst.mockResolvedValue(makeRequest());
    mockTx.request.updateMany.mockResolvedValue({ count: 0 });
    await expect(del()).rejects.toMatchObject({ statusCode: 404 });
    expect(mockTx.requestBounty.findMany).not.toHaveBeenCalled();
    expect(mockTx.user.updateMany).not.toHaveBeenCalled();
  });

  it('refunds nothing on a filled request, whose bounties were paid out', async () => {
    mockTx.request.findFirst.mockResolvedValue(
      makeRequest({ status: 'filled' })
    );
    await del();
    expect(mockTx.request.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 10, deletedAt: null, status: 'filled' }
      })
    );
    expect(mockTx.requestBounty.findMany).not.toHaveBeenCalled();
    expect(mockTx.user.updateMany).not.toHaveBeenCalled();
  });
});
