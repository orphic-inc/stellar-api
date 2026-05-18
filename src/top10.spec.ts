import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank
} from './test/apiTestHarness';
import * as top10Module from './modules/top10';

jest.mock('./modules/top10', () => ({
  getTopReleases: jest.fn(),
  getTopUsers: jest.fn(),
  getTopTags: jest.fn(),
  getTopVotedReleases: jest.fn(),
  getHistorySnapshot: jest.fn(),
  createSnapshot: jest.fn(),
  binomialScore: jest.requireActual('./modules/top10').binomialScore
}));

const top10Mock = top10Module as jest.Mocked<typeof top10Module>;

// ─── BPCI unit tests ──────────────────────────────────────────────────────────

describe('binomialScore', () => {
  it('returns 0 for zero total', () => {
    expect(top10Module.binomialScore(0, 0)).toBe(0);
  });

  it('returns 0 for negative ups', () => {
    expect(top10Module.binomialScore(-1, 5)).toBe(0);
  });

  it('returns higher score for more positive ratio', () => {
    const highPositive = top10Module.binomialScore(90, 100);
    const lowPositive = top10Module.binomialScore(10, 100);
    expect(highPositive).toBeGreaterThan(lowPositive);
  });

  it('returns lower score for low vote count even with all ups', () => {
    const fewVotes = top10Module.binomialScore(3, 3);
    const manyVotes = top10Module.binomialScore(100, 100);
    expect(manyVotes).toBeGreaterThan(fewVotes);
  });

  it('score is between 0 and 1', () => {
    const score = top10Module.binomialScore(50, 100);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('ranks correctly: more votes at same ratio beats fewer votes', () => {
    const s1 = top10Module.binomialScore(8, 10);
    const s2 = top10Module.binomialScore(80, 100);
    expect(s2).toBeGreaterThan(s1);
  });
});

// ─── API route tests ──────────────────────────────────────────────────────────

const RELEASE_ITEM = {
  rank: 1,
  releaseId: 1,
  title: 'Test Release',
  year: 2024,
  artistId: 1,
  artistName: 'Test Artist',
  type: 'Album',
  releaseType: 'Studio',
  tags: [{ id: 1, name: 'jazz' }],
  consumerCount: 50,
  totalBytesConsumed: '1073741824',
  contributionCount: 3
};

const USER_ITEM = {
  rank: 1,
  userId: 2,
  username: 'poweruser',
  avatar: null,
  contributed: '10737418240',
  consumed: '5368709120',
  ratio: 2.0,
  numContributions: 15,
  contributionSpeed: 1024,
  consumeSpeed: 512,
  joinedAt: new Date().toISOString(),
  rankName: 'Member',
  rankLevel: 10
};

const TAG_ITEM = {
  rank: 1,
  tagId: 1,
  name: 'jazz',
  uses: 250,
  positiveVotes: 30,
  negativeVotes: 2
};

const VOTE_ITEM = {
  rank: 1,
  releaseId: 1,
  title: 'Classic Album',
  year: 1959,
  artistName: 'Miles Davis',
  ups: 95,
  downs: 5,
  total: 100,
  score: 0.8924,
  positivePercent: 95.0
};

describe('GET /api/top10/releases', () => {
  beforeEach(() => resetApiTestState());

  it('returns top releases with defaults', async () => {
    top10Mock.getTopReleases.mockResolvedValue([RELEASE_ITEM]);
    const res = await request(app).get('/api/top10/releases');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(top10Mock.getTopReleases).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'day', limit: 10 })
    );
  });

  it('rejects invalid limit', async () => {
    const res = await request(app).get('/api/top10/releases?limit=50');
    expect(res.status).toBe(400);
  });

  it('rejects invalid type', async () => {
    const res = await request(app).get('/api/top10/releases?type=hourly');
    expect(res.status).toBe(400);
  });

  it('passes excludeTags and format to module', async () => {
    top10Mock.getTopReleases.mockResolvedValue([]);
    await request(app).get(
      '/api/top10/releases?type=week&limit=100&excludeTags=pop,rock&format=flac'
    );
    expect(top10Mock.getTopReleases).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'week',
        limit: 100,
        excludeTags: 'pop,rock',
        format: 'flac'
      })
    );
  });
});

describe('GET /api/top10/users', () => {
  beforeEach(() => resetApiTestState());

  it('returns top users', async () => {
    top10Mock.getTopUsers.mockResolvedValue([USER_ITEM]);
    const res = await request(app).get('/api/top10/users');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(top10Mock.getTopUsers).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'contributed', limit: 10 })
    );
  });

  it('accepts consumeSpeed type', async () => {
    top10Mock.getTopUsers.mockResolvedValue([]);
    const res = await request(app).get(
      '/api/top10/users?type=consumeSpeed&limit=250'
    );
    expect(res.status).toBe(200);
    expect(top10Mock.getTopUsers).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'consumeSpeed', limit: 250 })
    );
  });

  it('rejects invalid type', async () => {
    const res = await request(app).get('/api/top10/users?type=bogus');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/top10/tags', () => {
  beforeEach(() => resetApiTestState());

  it('returns top tags', async () => {
    top10Mock.getTopTags.mockResolvedValue([TAG_ITEM]);
    const res = await request(app).get('/api/top10/tags');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });

  it('accepts voted type', async () => {
    top10Mock.getTopTags.mockResolvedValue([]);
    const res = await request(app).get('/api/top10/tags?type=voted&limit=100');
    expect(res.status).toBe(200);
    expect(top10Mock.getTopTags).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'voted', limit: 100 })
    );
  });
});

describe('GET /api/top10/votes', () => {
  beforeEach(() => resetApiTestState());

  it('returns top voted releases', async () => {
    top10Mock.getTopVotedReleases.mockResolvedValue([VOTE_ITEM]);
    const res = await request(app).get('/api/top10/votes');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(top10Mock.getTopVotedReleases).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 25 })
    );
  });

  it('rejects invalid limit (not in 25/100/250)', async () => {
    const res = await request(app).get('/api/top10/votes?limit=10');
    expect(res.status).toBe(400);
  });

  it('passes tag and year filters', async () => {
    top10Mock.getTopVotedReleases.mockResolvedValue([]);
    await request(app).get('/api/top10/votes?tags=jazz&year=2020');
    expect(top10Mock.getTopVotedReleases).toHaveBeenCalledWith(
      expect.objectContaining({ tags: 'jazz', year: 2020 })
    );
  });
});

describe('GET /api/top10/history', () => {
  beforeEach(() => resetApiTestState());

  it('requires staff permission', async () => {
    const res = await request(app).get('/api/top10/history');
    expect(res.status).toBe(403);
  });

  it('returns the snapshot with staff permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ staff: true })
    );
    const snapshot = { type: 'Daily', date: '2026-01-01', items: [] };
    top10Mock.getHistorySnapshot.mockResolvedValue(snapshot as never);

    const res = await request(app).get('/api/top10/history?date=2026-01-01');

    expect(res.status).toBe(200);
    expect(top10Mock.getHistorySnapshot).toHaveBeenCalled();
  });

  it('returns 404 when no snapshot exists for the date', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ staff: true })
    );
    top10Mock.getHistorySnapshot.mockResolvedValue(null);

    const res = await request(app).get('/api/top10/history');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('No snapshot found for this date and type');
  });
});

describe('POST /api/top10/snapshot', () => {
  beforeEach(() => resetApiTestState());

  it('requires admin permission', async () => {
    const res = await request(app).post('/api/top10/snapshot');
    expect(res.status).toBe(403);
  });

  it('creates a Daily snapshot with admin permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ admin: true })
    );
    top10Mock.createSnapshot.mockResolvedValue(undefined);

    const res = await request(app).post('/api/top10/snapshot');

    expect(res.status).toBe(200);
    expect(res.body.msg).toBe('Snapshot created');
    expect(top10Mock.createSnapshot).toHaveBeenCalledWith('Daily');
  });

  it('passes Weekly type when body.type is Weekly', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ admin: true })
    );
    top10Mock.createSnapshot.mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/top10/snapshot')
      .send({ type: 'Weekly' });

    expect(res.status).toBe(200);
    expect(top10Mock.createSnapshot).toHaveBeenCalledWith('Weekly');
  });
});
