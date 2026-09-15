import {
  request,
  app,
  resetApiTestState,
  makeUserRank,
  setCurrentUserPermissions
} from './test/apiTestHarness';
import { TEST_USER_ID } from './test/factories';
import * as ratioPolicyModule from './modules/ratioPolicy';

jest.mock('./modules/ratioPolicy', () => ({
  getPolicyState: jest.fn(),
  overridePolicyStatus: jest.fn(),
  evaluateRatioPolicy: jest.fn(),
  listRatioWatch: jest.fn()
}));

const ratioPolicyMock = ratioPolicyModule as jest.Mocked<
  typeof ratioPolicyModule
>;

const setManager = () =>
  setCurrentUserPermissions(
    makeUserRank({
      ratio_policy_manage: true
    }).permissions as Record<string, boolean>
  );

const POLICY_VIEW = {
  status: 'OK' as const,
  watchStartedAt: null,
  watchExpiresAt: null,
  downloadDisabledAt: null,
  disabledCause: null,
  lastEvaluatedAt: new Date().toISOString()
};

beforeEach(() => resetApiTestState());

// ─── GET /api/ratio-policy/:userId ────────────────────────────────────────────

describe('GET /api/ratio-policy/:userId', () => {
  it('returns 403 without ratio_policy_manage permission', async () => {
    const res = await request(app).get('/api/ratio-policy/9');
    expect(res.status).toBe(403);
  });

  it('returns the policy state for a user', async () => {
    setManager();
    ratioPolicyMock.getPolicyState.mockResolvedValue(POLICY_VIEW);

    const res = await request(app).get('/api/ratio-policy/9');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OK');
    expect(ratioPolicyMock.getPolicyState).toHaveBeenCalledWith(9);
  });
});

// ─── POST /api/ratio-policy/:userId/override ──────────────────────────────────

describe('POST /api/ratio-policy/:userId/override', () => {
  it('returns 403 without ratio_policy_manage permission', async () => {
    const res = await request(app)
      .post('/api/ratio-policy/9/override')
      .send({ status: 'OK' });
    expect(res.status).toBe(403);
  });

  it('overrides the policy status as the acting staff member, and returns the new state', async () => {
    setManager();
    const updated = { ...POLICY_VIEW, status: 'WATCH' as const };
    ratioPolicyMock.overridePolicyStatus.mockResolvedValue(updated);

    const res = await request(app).post('/api/ratio-policy/9/override').send({
      status: 'WATCH',
      reason: 'Trading invites',
      message: 'Please stop.'
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('WATCH');
    expect(ratioPolicyMock.overridePolicyStatus).toHaveBeenCalledWith(
      TEST_USER_ID,
      9,
      { status: 'WATCH', reason: 'Trading invites', message: 'Please stop.' }
    );
  });

  it.each([{}, { reason: '   ' }])(
    'returns 400 without a reason (#646), and overrides nothing: %j',
    async (extra) => {
      setManager();

      const res = await request(app)
        .post('/api/ratio-policy/9/override')
        .send({ status: 'OK', ...extra });

      expect(res.status).toBe(400);
      expect(ratioPolicyMock.overridePolicyStatus).not.toHaveBeenCalled();
    }
  );

  it('returns 400 for an invalid status value', async () => {
    setManager();

    const res = await request(app)
      .post('/api/ratio-policy/9/override')
      .send({ status: 'INVALID_STATUS', reason: 'x' });

    expect(res.status).toBe(400);
  });
});

// ─── GET /api/users/ratio-watch ───────────────────────────────────────────────

describe('GET /api/users/ratio-watch', () => {
  it('returns 403 without ratio_policy_manage permission', async () => {
    const res = await request(app).get('/api/users/ratio-watch');
    expect(res.status).toBe(403);
  });

  it('pages the list from listRatioWatch', async () => {
    setManager();
    ratioPolicyMock.listRatioWatch.mockResolvedValue({ rows: [], total: 0 });

    const res = await request(app).get('/api/users/ratio-watch?limit=5');

    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ total: 0, limit: 5 });
    expect(ratioPolicyMock.listRatioWatch).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5 })
    );
  });
});
