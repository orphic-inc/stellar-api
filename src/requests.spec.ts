/**
 * Route-level tests for the requests API.
 *
 * These verify: auth enforcement, permission gates, validation, and that the
 * correct module functions are invoked with the right arguments.
 *
 * For deeper service-logic tests (atomic fill, ledger correctness, refund
 * flows) see src/modules/requests.spec.ts.
 */

import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank
} from './test/apiTestHarness';
import { makeRequest } from './test/factories';
import * as requestModule from './modules/requests';

jest.mock('./modules/requests');

const mod = requestModule as jest.Mocked<typeof requestModule>;

// Grant staff+admin permissions so permission-gated routes pass in most tests
const setStaffPerms = () =>
  prismaMock.userRank.findUnique.mockResolvedValue(
    makeUserRank({ staff: true, admin: true })
  );

const setDefaultRequest = (overrides: Parameters<typeof makeRequest>[0] = {}) =>
  prismaMock.request.findUnique.mockResolvedValue(makeRequest(overrides));

const OPEN_REQUEST = {
  id: 1,
  communityId: 1,
  userId: 7,
  title: 'Test',
  description: 'Desc',
  type: 'Music',
  year: null,
  image: null,
  status: 'open',
  fillerId: null,
  filledAt: null,
  filledContributionId: null,
  totalBounty: '104857600',
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  bounties: []
};

describe('GET /api/requests', () => {
  beforeEach(() => resetApiTestState());

  it('returns 200 without auth', async () => {
    mod.listRequests.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, limit: 25, totalPages: 0 }
    });
    const res = await request(app).get('/api/requests');
    expect(res.status).toBe(200);
  });

  it('passes communityId and status filters through', async () => {
    mod.listRequests.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, limit: 25, totalPages: 0 }
    });
    await request(app).get('/api/requests?communityId=3&status=open');
    expect(mod.listRequests).toHaveBeenCalledWith(
      expect.objectContaining({ communityId: 3, status: 'open' })
    );
  });

  it('rejects invalid status filter with 400', async () => {
    const res = await request(app).get('/api/requests?status=invalid');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/requests', () => {
  beforeEach(() => {
    resetApiTestState();
    // create uses requireAuth only (no permission gate beyond being logged in)
  });

  it('returns 201 with valid payload and coerces bounty to BigInt', async () => {
    mod.createRequest.mockResolvedValue(OPEN_REQUEST);
    const res = await request(app).post('/api/requests').send({
      communityId: 1,
      type: 'Music',
      title: 'My Request',
      description: 'Looking for this album',
      bounty: '104857600'
    });
    expect(res.status).toBe(201);
    expect(mod.createRequest).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ bounty: BigInt('104857600') })
    );
  });

  it('rejects missing required fields with 400', async () => {
    const res = await request(app).post('/api/requests').send({
      communityId: 1,
      type: 'Music'
      // title and description missing
    });
    expect(res.status).toBe(400);
    expect(mod.createRequest).not.toHaveBeenCalled();
  });

  it('propagates AppError from module', async () => {
    const { AppError } = await import('./lib/errors');
    mod.createRequest.mockRejectedValue(
      new AppError(400, 'Insufficient upload balance')
    );
    const res = await request(app).post('/api/requests').send({
      communityId: 1,
      type: 'Music',
      title: 'T',
      description: 'D',
      bounty: '104857600'
    });
    expect(res.status).toBe(400);
    expect(res.body.msg).toBe('Insufficient upload balance');
  });
});

describe('POST /api/requests/:id/fill', () => {
  beforeEach(() => {
    resetApiTestState();
  });

  it('calls fillRequest with caller userId, requestId, and contributionId', async () => {
    mod.fillRequest.mockResolvedValue({
      ...OPEN_REQUEST,
      status: 'filled'
    } as unknown as Awaited<ReturnType<typeof mod.fillRequest>>);
    const res = await request(app)
      .post('/api/requests/1/fill')
      .send({ contributionId: 5 });
    expect(res.status).toBe(200);
    expect(mod.fillRequest).toHaveBeenCalledWith(7, 1, 5);
  });

  it('rejects missing contributionId with 400', async () => {
    const res = await request(app).post('/api/requests/1/fill').send({});
    expect(res.status).toBe(400);
    expect(mod.fillRequest).not.toHaveBeenCalled();
  });

  it('returns 409 when module signals concurrent fill', async () => {
    const { AppError } = await import('./lib/errors');
    mod.fillRequest.mockRejectedValue(
      new AppError(409, 'Request was already filled by another submission')
    );
    const res = await request(app)
      .post('/api/requests/1/fill')
      .send({ contributionId: 5 });
    expect(res.status).toBe(409);
  });

  it('returns 403 when module rejects ownership violation', async () => {
    const { AppError } = await import('./lib/errors');
    mod.fillRequest.mockRejectedValue(
      new AppError(
        403,
        'You can only fill a request with your own contribution'
      )
    );
    const res = await request(app)
      .post('/api/requests/1/fill')
      .send({ contributionId: 99 });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/requests/:id/unfill', () => {
  beforeEach(() => {
    resetApiTestState();
    setStaffPerms(); // unfill requires staff or admin
  });

  it('calls unfillRequest with moderatorId and optional reason', async () => {
    mod.unfillRequest.mockResolvedValue(OPEN_REQUEST);
    const res = await request(app)
      .post('/api/requests/1/unfill')
      .send({ reason: 'Incorrect fill' });
    expect(res.status).toBe(200);
    expect(mod.unfillRequest).toHaveBeenCalledWith(7, 1, 'Incorrect fill');
  });

  it('allows unfill with no reason body', async () => {
    mod.unfillRequest.mockResolvedValue(OPEN_REQUEST);
    const res = await request(app).post('/api/requests/1/unfill').send({});
    expect(res.status).toBe(200);
    expect(mod.unfillRequest).toHaveBeenCalledWith(7, 1, undefined);
  });

  it('returns 403 when user lacks staff/admin permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());
    const res = await request(app)
      .post('/api/requests/1/unfill')
      .send({ reason: 'test' });
    expect(res.status).toBe(403);
    expect(mod.unfillRequest).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/requests/:id', () => {
  beforeEach(() => {
    resetApiTestState();
    setStaffPerms();
    setDefaultRequest(); // userId: 7 = authenticated user
  });

  it('allows owner to delete their own open request and returns 204', async () => {
    mod.deleteRequest.mockResolvedValue(undefined);
    const res = await request(app).delete('/api/requests/1');
    expect(res.status).toBe(204);
    expect(mod.deleteRequest).toHaveBeenCalledWith(7, 1, expect.any(Boolean));
  });

  it('returns 403 when non-owner non-staff tries to delete', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());
    prismaMock.request.findUnique.mockResolvedValue(
      makeRequest({ userId: 99 })
    );
    const res = await request(app).delete('/api/requests/1');
    expect(res.status).toBe(403);
    expect(mod.deleteRequest).not.toHaveBeenCalled();
  });

  it('returns 404 for non-existent or already-deleted request', async () => {
    prismaMock.request.findUnique.mockResolvedValue(null);
    const res = await request(app).delete('/api/requests/999');
    expect(res.status).toBe(404);
    expect(mod.deleteRequest).not.toHaveBeenCalled();
  });
});

describe('POST /api/requests/:id/bounty', () => {
  beforeEach(() => {
    resetApiTestState();
  });

  it('calls addBounty with correct args', async () => {
    mod.addBounty.mockResolvedValue(OPEN_REQUEST);
    const res = await request(app)
      .post('/api/requests/1/bounty')
      .send({ amount: '104857600' });
    expect(res.status).toBe(200);
    expect(mod.addBounty).toHaveBeenCalledWith(7, 1, BigInt('104857600'));
  });

  it('rejects zero amount with 400', async () => {
    const res = await request(app)
      .post('/api/requests/1/bounty')
      .send({ amount: '0' });
    expect(res.status).toBe(400);
    expect(mod.addBounty).not.toHaveBeenCalled();
  });
});
