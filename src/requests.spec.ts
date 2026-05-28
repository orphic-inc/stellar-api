/**
 * Route-level tests for the requests API.
 *
 * These verify: auth enforcement, permission gates, validation, and that the
 * correct lifecycle functions are invoked with the right arguments.
 *
 * For deeper service-logic tests (atomic fill, ledger correctness, refund
 * flows, authorization rules) see src/modules/requestLifecycle.spec.ts.
 */

import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank
} from './test/apiTestHarness';
import * as requestLifecycle from './modules/requestLifecycle';

jest.mock('./modules/requestLifecycle', () => ({
  ...jest.requireActual('./modules/requestLifecycle'),
  createRequest: jest.fn(),
  addBounty: jest.fn(),
  fillRequest: jest.fn(),
  unfillRequest: jest.fn(),
  deleteRequest: jest.fn(),
  listRequests: jest.fn(),
  getRequestDetail: jest.fn(),
  getBountyHistory: jest.fn(),
  toggleVote: jest.fn(),
  updateRequest: jest.fn()
}));

const mod = requestLifecycle as jest.Mocked<typeof requestLifecycle>;

// Grant staff+admin permissions so permission-gated routes pass in most tests
const setStaffPerms = () =>
  prismaMock.userRank.findUnique.mockResolvedValue(
    makeUserRank({ staff: true, admin: true, requests_moderate: true })
  );

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
  _count: { bounties: 0 },
  bounties: []
};

describe('GET /api/requests', () => {
  beforeEach(() => resetApiTestState());

  it('returns 200 without auth', async () => {
    mod.listRequests.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, limit: 25, totalPages: 0 }
    });
    const res = await request(app).get('/api/requests?page=1');
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

  it('passes full request-list filters and ordering through', async () => {
    mod.listRequests.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 2, limit: 25, totalPages: 0 }
    });

    await request(app).get(
      '/api/requests?q=fusion&artist=herbie&type=Music&year=1974&status=open&orderBy=voteCount&order=asc&page=2'
    );

    expect(mod.listRequests).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'fusion',
        artist: 'herbie',
        type: 'Music',
        year: 1974,
        status: 'open',
        orderBy: 'voteCount',
        order: 'asc',
        page: 2
      })
    );
  });

  it('rejects invalid status filter with 400', async () => {
    const res = await request(app).get('/api/requests?status=invalid');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/requests', () => {
  beforeEach(() => resetApiTestState());

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
      new AppError(400, 'Insufficient contributed balance')
    );
    const res = await request(app).post('/api/requests').send({
      communityId: 1,
      type: 'Music',
      title: 'T',
      description: 'D',
      bounty: '104857600'
    });
    expect(res.status).toBe(400);
    expect(res.body.msg).toBe('Insufficient contributed balance');
  });
});

describe('POST /api/requests/:id/fill', () => {
  beforeEach(() => resetApiTestState());

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
    setStaffPerms();
  });

  it('calls unfillRequest with options object when caller is staff', async () => {
    mod.unfillRequest.mockResolvedValue(OPEN_REQUEST);
    const res = await request(app)
      .post('/api/requests/1/unfill')
      .send({ reason: 'Incorrect fill' });
    expect(res.status).toBe(200);
    expect(mod.unfillRequest).toHaveBeenCalledWith({
      requestId: 1,
      actorId: 7,
      canModerateRequests: true,
      reason: 'Incorrect fill'
    });
  });

  it('allows unfill with no reason body', async () => {
    mod.unfillRequest.mockResolvedValue(OPEN_REQUEST);
    const res = await request(app).post('/api/requests/1/unfill').send({});
    expect(res.status).toBe(200);
    expect(mod.unfillRequest).toHaveBeenCalledWith({
      requestId: 1,
      actorId: 7,
      canModerateRequests: true,
      reason: undefined
    });
  });

  it('passes canModerateRequests: false for non-staff user', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank()); // no staff
    mod.unfillRequest.mockResolvedValue(OPEN_REQUEST);
    const res = await request(app).post('/api/requests/1/unfill').send({});
    expect(res.status).toBe(200);
    expect(mod.unfillRequest).toHaveBeenCalledWith(
      expect.objectContaining({ canModerateRequests: false })
    );
  });

  it('propagates 403 from module when not authorized', async () => {
    const { AppError } = await import('./lib/errors');
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank()); // no staff
    mod.unfillRequest.mockRejectedValue(new AppError(403, 'Permission denied'));
    const res = await request(app)
      .post('/api/requests/1/unfill')
      .send({ reason: 'test' });
    expect(res.status).toBe(403);
  });

  it('propagates 422 from module when request is not filled', async () => {
    const { AppError } = await import('./lib/errors');
    mod.unfillRequest.mockRejectedValue(
      new AppError(422, 'Request is not filled')
    );
    const res = await request(app).post('/api/requests/1/unfill').send({});
    expect(res.status).toBe(422);
  });
});

describe('DELETE /api/requests/:id', () => {
  beforeEach(() => {
    resetApiTestState();
    setStaffPerms();
  });

  it('calls deleteRequest with correct options and returns 204', async () => {
    mod.deleteRequest.mockResolvedValue(undefined);
    const res = await request(app).delete('/api/requests/1');
    expect(res.status).toBe(204);
    expect(mod.deleteRequest).toHaveBeenCalledWith({
      requestId: 1,
      actorId: 7,
      canModerateRequests: true
    });
  });

  it('passes canModerateRequests: false for non-staff user', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank()); // no staff
    mod.deleteRequest.mockResolvedValue(undefined);
    const res = await request(app).delete('/api/requests/1');
    expect(res.status).toBe(204);
    expect(mod.deleteRequest).toHaveBeenCalledWith({
      requestId: 1,
      actorId: 7,
      canModerateRequests: false
    });
  });

  it('propagates 403 from module when not authorized', async () => {
    const { AppError } = await import('./lib/errors');
    mod.deleteRequest.mockRejectedValue(new AppError(403, 'Permission denied'));
    const res = await request(app).delete('/api/requests/1');
    expect(res.status).toBe(403);
  });

  it('propagates 404 from module when request not found', async () => {
    const { AppError } = await import('./lib/errors');
    mod.deleteRequest.mockRejectedValue(new AppError(404, 'Request not found'));
    const res = await request(app).delete('/api/requests/999');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/requests/:id/bounty', () => {
  beforeEach(() => resetApiTestState());

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

  it('propagates AppError from addBounty', async () => {
    const { AppError } = await import('./lib/errors');
    mod.addBounty.mockRejectedValue(
      new AppError(400, 'Insufficient contributed balance')
    );
    const res = await request(app)
      .post('/api/requests/1/bounty')
      .send({ amount: '104857600' });
    expect(res.status).toBe(400);
    expect(res.body.msg).toBe('Insufficient contributed balance');
  });
});

describe('GET /api/requests/:id', () => {
  beforeEach(() => resetApiTestState());

  it('returns 404 when the module throws not found', async () => {
    const { AppError } = await import('./lib/errors');
    mod.getRequestDetail.mockRejectedValue(
      new AppError(404, 'Request not found')
    );

    const res = await request(app).get('/api/requests/999');

    expect(res.status).toBe(404);
  });

  it('returns serialized request detail with vote metadata', async () => {
    mod.getRequestDetail.mockResolvedValue({
      ...OPEN_REQUEST,
      totalBounty: '104857600',
      voteCount: 1,
      votes: [{ userId: 7 }]
    } as unknown as Awaited<ReturnType<typeof mod.getRequestDetail>>);

    const res = await request(app).get('/api/requests/1');

    expect(res.status).toBe(200);
    expect(res.body.totalBounty).toBe('104857600');
    expect(res.body.voteCount).toBe(1);
    expect(res.body.votes).toEqual([{ userId: 7 }]);
  });

  it('calls getRequestDetail with the parsed request id', async () => {
    mod.getRequestDetail.mockResolvedValue({
      ...OPEN_REQUEST,
      voteCount: 0,
      votes: []
    } as unknown as Awaited<ReturnType<typeof mod.getRequestDetail>>);

    await request(app).get('/api/requests/42');

    expect(mod.getRequestDetail).toHaveBeenCalledWith(42);
  });
});

describe('PUT /api/requests/:id', () => {
  beforeEach(() => {
    resetApiTestState();
    setStaffPerms();
  });

  it('calls updateRequest with correct options including canModerateRequests', async () => {
    mod.updateRequest.mockResolvedValue({
      ...OPEN_REQUEST,
      title: 'Updated'
    } as unknown as Awaited<ReturnType<typeof mod.updateRequest>>);

    const res = await request(app).put('/api/requests/1').send({
      title: 'Updated',
      image: ''
    });

    expect(res.status).toBe(200);
    expect(mod.updateRequest).toHaveBeenCalledWith({
      requestId: 1,
      actorId: 7,
      canModerateRequests: true,
      input: { title: 'Updated', image: null } // image '' → null via Zod transform
    });
  });

  it('passes canModerateRequests: false for non-staff user', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank()); // no staff
    mod.updateRequest.mockResolvedValue(
      OPEN_REQUEST as unknown as Awaited<ReturnType<typeof mod.updateRequest>>
    );

    await request(app).put('/api/requests/1').send({ title: 'T' });

    expect(mod.updateRequest).toHaveBeenCalledWith(
      expect.objectContaining({ canModerateRequests: false })
    );
  });

  it('propagates 404 from module when request not found', async () => {
    const { AppError } = await import('./lib/errors');
    mod.updateRequest.mockRejectedValue(new AppError(404, 'Request not found'));

    const res = await request(app).put('/api/requests/1').send({ title: 'T' });

    expect(res.status).toBe(404);
  });

  it('propagates 422 from module when editing a non-open request', async () => {
    const { AppError } = await import('./lib/errors');
    mod.updateRequest.mockRejectedValue(
      new AppError(422, 'Only open requests can be edited')
    );

    const res = await request(app).put('/api/requests/1').send({ title: 'T' });

    expect(res.status).toBe(422);
  });

  it('propagates 403 from module when not authorized', async () => {
    const { AppError } = await import('./lib/errors');
    mod.updateRequest.mockRejectedValue(new AppError(403, 'Permission denied'));

    const res = await request(app).put('/api/requests/1').send({ title: 'T' });

    expect(res.status).toBe(403);
  });
});

describe('POST /api/requests/:id/vote', () => {
  beforeEach(() => resetApiTestState());

  it('calls toggleVote and returns voted: true', async () => {
    mod.toggleVote.mockResolvedValue({ voted: true });

    const res = await request(app).post('/api/requests/1/vote');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ voted: true });
    expect(mod.toggleVote).toHaveBeenCalledWith(1, 7);
  });

  it('calls toggleVote and returns voted: false when removing a vote', async () => {
    mod.toggleVote.mockResolvedValue({ voted: false });

    const res = await request(app).post('/api/requests/1/vote');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ voted: false });
  });

  it('returns 404 when module throws not found', async () => {
    const { AppError } = await import('./lib/errors');
    mod.toggleVote.mockRejectedValue(new AppError(404, 'Request not found'));

    const res = await request(app).post('/api/requests/999/vote');

    expect(res.status).toBe(404);
  });
});

describe('GET /api/requests/:id/bounty-history', () => {
  beforeEach(() => resetApiTestState());

  it('calls getBountyHistory and returns bounties and actions', async () => {
    mod.getBountyHistory.mockResolvedValue({
      bounties: [
        {
          id: 1,
          requestId: 1,
          userId: 7,
          amount: BigInt('104857600'),
          createdAt: new Date(),
          user: { id: 7, username: 'testuser' }
        }
      ],
      actions: []
    } as unknown as Awaited<ReturnType<typeof mod.getBountyHistory>>);

    const res = await request(app).get('/api/requests/1/bounty-history');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('bounties');
    expect(res.body).toHaveProperty('actions');
    expect(res.body.bounties).toHaveLength(1);
    expect(mod.getBountyHistory).toHaveBeenCalledWith(1);
  });

  it('returns 404 when module throws not found', async () => {
    const { AppError } = await import('./lib/errors');
    mod.getBountyHistory.mockRejectedValue(
      new AppError(404, 'Request not found')
    );

    const res = await request(app).get('/api/requests/999/bounty-history');

    expect(res.status).toBe(404);
  });
});
