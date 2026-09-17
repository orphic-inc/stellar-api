/**
 * The Member Feed token (ADR-0014, #262): derivation, authentication, the
 * settings read and both rotations.
 *
 * The feed routes that consume `authenticateFeedOwner` arrive in #262's feeds
 * PR; the rules they depend on are pinned here first, because every one of
 * them is a security property a route test would only see indirectly.
 */
import {
  request,
  app,
  prismaMock,
  makeUserRank,
  resetApiTestState,
  setCurrentUserPermissions
} from './test/apiTestHarness';
import { feeds } from './modules/config';
import { sendSystemMessage } from './modules/pm';
import {
  FEED_TOKEN_LENGTH,
  authenticateFeedOwner,
  deriveFeedToken,
  feedTokenMatches
} from './modules/feedToken';

const sendSystemMessageMock = sendSystemMessage as jest.Mock;
const SECRET = feeds.secret;

const grant = (permissions: Record<string, boolean>) =>
  setCurrentUserPermissions(
    makeUserRank(permissions).permissions as Record<string, boolean>
  );

const auditData = () =>
  (
    prismaMock.auditLog.create.mock.calls[0]?.[0] as {
      data: { action: string; metadata: Record<string, unknown> };
    }
  ).data;

const owner = (fields: Record<string, unknown> = {}) =>
  ({ id: 9, disabled: false, feedTokenEpoch: 0, ...fields }) as never;

beforeEach(() => {
  resetApiTestState();
  feeds.secret = SECRET;
  prismaMock.$transaction.mockImplementation(async (cb: unknown) =>
    (cb as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock)
  );
  prismaMock.auditLog.create.mockResolvedValue({} as never);
  sendSystemMessageMock.mockResolvedValue({ ok: true });
});

afterAll(() => {
  feeds.secret = SECRET;
});

describe('deriveFeedToken', () => {
  it('is stable, fixed-length lowercase hex', () => {
    const token = deriveFeedToken(9, 0);
    expect(token).toMatch(new RegExp(`^[0-9a-f]{${FEED_TOKEN_LENGTH}}$`));
    expect(deriveFeedToken(9, 0)).toBe(token);
  });

  it('changes with the member, the epoch and the secret', () => {
    const token = deriveFeedToken(9, 0);
    expect(deriveFeedToken(10, 0)).not.toBe(token);
    expect(deriveFeedToken(9, 1)).not.toBe(token);
    feeds.secret = 'g'.repeat(32);
    expect(deriveFeedToken(9, 0)).not.toBe(token);
  });

  it('does not collide across the id/epoch boundary', () => {
    // "feed:1:23" and "feed:12:3" must be different inputs. The separator is
    // what guarantees it; dropping it would make these two tokens equal.
    expect(deriveFeedToken(1, 23)).not.toBe(deriveFeedToken(12, 3));
  });
});

describe('feedTokenMatches', () => {
  it('rejects a wrong-length or non-hex token without throwing', () => {
    // timingSafeEqual throws on unequal lengths; the shape check must run first.
    const expected = deriveFeedToken(9, 0);
    expect(feedTokenMatches(expected, expected.slice(1))).toBe(false);
    expect(feedTokenMatches(expected, `${expected}0`)).toBe(false);
    expect(feedTokenMatches(expected, expected.toUpperCase())).toBe(false);
    expect(feedTokenMatches(expected, '')).toBe(false);
  });
});

describe('authenticateFeedOwner', () => {
  it('answers the owner for their current token', async () => {
    prismaMock.user.findUnique.mockResolvedValue(owner({ feedTokenEpoch: 2 }));

    await expect(
      authenticateFeedOwner(9, deriveFeedToken(9, 2))
    ).resolves.toEqual({ id: 9 });
  });

  it('answers null for a token from before a rotation', async () => {
    prismaMock.user.findUnique.mockResolvedValue(owner({ feedTokenEpoch: 3 }));

    await expect(
      authenticateFeedOwner(9, deriveFeedToken(9, 2))
    ).resolves.toBeNull();
  });

  it("answers null for another member's token", async () => {
    prismaMock.user.findUnique.mockResolvedValue(owner());

    await expect(
      authenticateFeedOwner(9, deriveFeedToken(10, 0))
    ).resolves.toBeNull();
  });

  it('answers null for a disabled member holding a valid token', async () => {
    prismaMock.user.findUnique.mockResolvedValue(owner({ disabled: true }));

    await expect(
      authenticateFeedOwner(9, deriveFeedToken(9, 0))
    ).resolves.toBeNull();
  });

  it('answers null for an unknown member', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expect(
      authenticateFeedOwner(9, deriveFeedToken(9, 0))
    ).resolves.toBeNull();
  });

  it('answers null without reading the database while feeds are disabled', async () => {
    const token = deriveFeedToken(9, 0);
    feeds.secret = '';
    prismaMock.user.findUnique.mockResolvedValue(owner());

    await expect(authenticateFeedOwner(9, token)).resolves.toBeNull();
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('answers null without reading the database for a malformed token', async () => {
    await expect(authenticateFeedOwner(9, 'not-a-token')).resolves.toBeNull();
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });
});

describe('GET /api/profile/me/feeds', () => {
  it('answers four complete URLs for the session member, never a bare token', async () => {
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({
      feedTokenEpoch: 4
    } as never);
    const token = deriveFeedToken(7, 4);

    const res = await request(app).get('/api/profile/me/feeds');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      enabled: true,
      feeds: {
        contributions: `http://localhost:3000/api/feeds/contributions.xml?user=7&token=${token}`,
        mine: `http://localhost:3000/api/feeds/mine.xml?user=7&token=${token}`,
        news: `http://localhost:3000/api/feeds/news.xml?user=7&token=${token}`,
        bookmarks: `http://localhost:3000/api/feeds/bookmarks.xml?user=7&token=${token}`
      }
    });
  });

  it('answers enabled: false and no URLs while feeds are disabled', async () => {
    feeds.secret = '';
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({
      feedTokenEpoch: 0
    } as never);

    const res = await request(app).get('/api/profile/me/feeds');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false });
  });
});

describe('POST /api/profile/me/feed-token/rotate', () => {
  it('increments the epoch, audits a self-rotation, and answers the new URLs', async () => {
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({
      feedTokenEpoch: 5
    } as never);

    const res = await request(app).post('/api/profile/me/feed-token/rotate');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    // An increment, not an absolute write: two concurrent rotations both revoke.
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { feedTokenEpoch: { increment: 1 } }
    });
    expect(res.body.feeds.news).toContain(`token=${deriveFeedToken(7, 5)}`);
    expect(res.body.feeds.news).not.toContain(deriveFeedToken(7, 4));
    expect(auditData()).toMatchObject({
      action: 'user.feed_token_rotated',
      metadata: { self: true, messaged: false }
    });
    expect(sendSystemMessageMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/users/:id/feed-token/rotate', () => {
  const body = { reason: 'Feed URL posted publicly' };

  beforeEach(() => grant({ users_edit_reset_feeds: true }));

  it('rotates, audits the staff reason, and returns no URLs to staff', async () => {
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({
      feedTokenEpoch: 1
    } as never);

    const res = await request(app)
      .post('/api/users/9/feed-token/rotate')
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ msg: 'Feed token rotated' });
    expect(JSON.stringify(res.body)).not.toContain(deriveFeedToken(9, 1));
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { feedTokenEpoch: { increment: 1 } }
    });
    expect(auditData()).toMatchObject({
      action: 'user.feed_token_rotated',
      metadata: {
        self: false,
        reason: 'Feed URL posted publicly',
        messaged: false
      }
    });
  });

  it('PMs the member the message, never the staff reason', async () => {
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({
      feedTokenEpoch: 1
    } as never);

    await request(app)
      .post('/api/users/9/feed-token/rotate')
      .send({ ...body, message: 'We reset your feeds.' });

    expect(sendSystemMessageMock).toHaveBeenCalledTimes(1);
    const [to, subject, text] = sendSystemMessageMock.mock.calls[0];
    expect([to, subject]).toEqual([9, 'Your feed URLs have been reset']);
    expect(text).toContain('We reset your feeds.');
    expect(text).not.toContain('Feed URL posted publicly');
    expect(auditData().metadata.messaged).toBe(true);
  });

  it('still answers 200 when the PM fails, because the rotation has committed', async () => {
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({
      feedTokenEpoch: 1
    } as never);
    sendSystemMessageMock.mockRejectedValue(new Error('smtp down'));

    const res = await request(app)
      .post('/api/users/9/feed-token/rotate')
      .send({ ...body, message: 'x' });

    expect(res.status).toBe(200);
  });

  it('answers 404 for a missing member, and neither audits nor PMs', async () => {
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(app)
      .post('/api/users/9/feed-token/rotate')
      .send({ ...body, message: 'x' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'User not found' });
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    expect(sendSystemMessageMock).not.toHaveBeenCalled();
  });

  it('requires a reason', async () => {
    const res = await request(app)
      .post('/api/users/9/feed-token/rotate')
      .send({});

    expect(res.status).toBe(400);
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it('requires users_edit_reset_feeds — users_edit is not enough', async () => {
    grant({ users_edit: true });

    const res = await request(app)
      .post('/api/users/9/feed-token/rotate')
      .send(body);

    expect(res.status).toBe(403);
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });
});
