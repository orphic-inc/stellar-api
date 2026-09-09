/**
 * #564, the final route sweep — the sixteen surfaces left after the big ones.
 *
 * They are individually small, which is exactly why they survived five earlier
 * passes: no single one was worth a PR, and the issue's queue never named any of
 * them. The gate is what surfaced them.
 *
 * Table-driven, because the shape genuinely is uniform here: a by-id write with
 * a read in front of it, and P2025 reaching the global handler as a 500.
 */
import { Prisma } from '@prisma/client';
import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank,
  setCurrentUserPermissions
} from './test/apiTestHarness';

const err = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test'
  });

const ALL_PERMS = {
  admin: true,
  staff: true,
  users_manage: true,
  users_moderate: true,
  donor_manage: true,
  news_manage: true,
  rules_manage: true,
  tags_manage: true,
  site_history_manage: true,
  bad_passwords_manage: true,
  email_blacklist_manage: true,
  ip_bans_manage: true,
  forums_moderate: true
};

beforeEach(() => {
  resetApiTestState();
  setCurrentUserPermissions(ALL_PERMS);
  prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank(ALL_PERMS));
});

/**
 * Each case: the request, the model whose write is broken, and what the handler
 * must answer instead of 500. `prime` sets up whatever read guards the route.
 */
const cases: Array<{
  name: string;
  prime?: () => void;
  reject: () => void;
  send: () => Promise<{ status: number; body: unknown }>;
  status: number;
  msg: string;
}> = [
  {
    name: 'DELETE /auth/sessions/:id',
    prime: () =>
      // findFirst, not findUnique — the route scopes the lookup to the caller.
      // Mocking the wrong one 404s before the guard and the test passes for the
      // wrong reason, which the mutation run caught.
      prismaMock.userSession.findFirst.mockResolvedValue({
        id: 1,
        userId: 7
      } as never),
    reject: () => prismaMock.userSession.update.mockRejectedValue(err('P2025')),
    send: () => request(app).delete('/api/auth/sessions/1'),
    status: 404,
    msg: 'Session not found'
  },
  {
    name: 'DELETE /bad-passwords/:id',
    prime: () =>
      prismaMock.badPassword.findUnique.mockResolvedValue({ id: 1 } as never),
    reject: () => prismaMock.badPassword.delete.mockRejectedValue(err('P2025')),
    send: () => request(app).delete('/api/bad-passwords/1'),
    status: 404,
    msg: 'Entry not found'
  },
  {
    name: 'DELETE /email-blacklist/:id',
    prime: () =>
      prismaMock.emailBlacklist.findUnique.mockResolvedValue({
        id: 1
      } as never),
    reject: () =>
      prismaMock.emailBlacklist.delete.mockRejectedValue(err('P2025')),
    send: () => request(app).delete('/api/email-blacklist/1'),
    status: 404,
    msg: 'Entry not found'
  },
  {
    name: 'DELETE /ip-bans/:id',
    prime: () =>
      prismaMock.ipBan.findUnique.mockResolvedValue({ id: 1 } as never),
    reject: () => prismaMock.ipBan.delete.mockRejectedValue(err('P2025')),
    send: () => request(app).delete('/api/ip-bans/1'),
    status: 404,
    msg: 'Ban not found'
  },
  {
    name: 'DELETE /notifications/:id',
    prime: () =>
      prismaMock.notification.findUnique.mockResolvedValue({
        id: 1,
        userId: 7
      } as never),
    reject: () =>
      prismaMock.notification.delete.mockRejectedValue(err('P2025')),
    send: () => request(app).delete('/api/notifications/1'),
    status: 404,
    msg: 'Notification not found'
  },
  {
    name: 'DELETE /site-history/:id',
    prime: () =>
      prismaMock.siteHistory.findUnique.mockResolvedValue({ id: 1 } as never),
    reject: () => prismaMock.siteHistory.delete.mockRejectedValue(err('P2025')),
    send: () => request(app).delete('/api/site-history/1'),
    status: 404,
    msg: 'Entry not found'
  },
  {
    name: 'DELETE /tag-aliases/:id',
    prime: () =>
      prismaMock.tagAlias.findUnique.mockResolvedValue({ id: 1 } as never),
    reject: () => prismaMock.tagAlias.delete.mockRejectedValue(err('P2025')),
    send: () => request(app).delete('/api/tag-aliases/1'),
    status: 404,
    msg: 'Tag alias not found'
  }
];

describe('the remaining surfaces — a missing row answers 404, not 500 (#564)', () => {
  it.each(cases)('$name', async ({ prime, reject, send, status, msg }) => {
    prime?.();
    reject();

    const res = await send();

    expect(res.status).toBe(status);
    expect(res.body).toEqual({ msg });
  });
});

describe('unique constraints answer 409, not 500 (#564)', () => {
  it('POST /bad-passwords on a duplicate', async () => {
    // `BadPassword.password` is unique and the model has no foreign key.
    prismaMock.badPassword.findUnique.mockResolvedValue(null);
    prismaMock.badPassword.create.mockRejectedValue(err('P2002'));

    const res = await request(app)
      .post('/api/bad-passwords')
      .send({ password: 'hunter2000' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ msg: 'That password is already listed' });
  });
});

describe('a dangling body id answers 400, not 500 (#564)', () => {
  it('POST /donations names a user that is gone', async () => {
    // The read above answers the ordinary case; this is the window it leaves.
    prismaMock.user.findUnique.mockResolvedValue({ id: 5 } as never);
    prismaMock.donation.create.mockRejectedValue(err('P2003'));

    const res = await request(app).post('/api/donations').send({
      userId: 5,
      amount: 10,
      email: 'd@example.com',
      donatedAt: '2026-01-01T00:00:00.000Z',
      currency: 'USD',
      source: 'manual',
      reason: 'a donation'
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ msg: 'User not found' });
  });
});

describe('errors that are not constraint violations still propagate (#564)', () => {
  it('DELETE /ip-bans/:id', async () => {
    // The read must succeed or this 404s before reaching the guard — which is
    // how several cases above were passing for the wrong reason until this test
    // expected a 500 and got a 404.
    prismaMock.ipBan.findUnique.mockResolvedValue({ id: 1 } as never);
    prismaMock.ipBan.delete.mockRejectedValue(new Error('connection lost'));

    const res = await request(app).delete('/api/ip-bans/1');

    expect(res.status).toBe(500);
  });
});
