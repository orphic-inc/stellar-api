/**
 * Registration capacity at the route (#624, ADR-0040). Its own file rather than
 * more of install-auth.spec.ts, which is already past the size Codacy flags.
 *
 * What a mocked Prisma can show: the refusal, its message, that nothing is
 * written, and that the lock is taken before the count. What it cannot show is
 * that the lock works — registrationCapacity.integration.ts owns that.
 */
import {
  request,
  app,
  prismaMock,
  makeUserRank,
  resetApiTestState
} from './test/apiTestHarness';
import { asUserMock } from './test/factories';

describe('POST /api/auth/register — capacity (#624)', () => {
  beforeEach(() => {
    resetApiTestState();
  });

  const settingsWith = (
    registrationStatus: 'open' | 'invite',
    maxUsers: number
  ) =>
    prismaMock.siteSettings.upsert.mockResolvedValue({
      id: 1,
      approvedDomains: [],
      registrationStatus,
      maxUsers,
      dismissedLaunchChecklist: [],
      installedAt: null,
      badPasswordsSeededAt: null,
      updatedAt: new Date()
    });

  // Everything registerUser checks before its transaction passes, so the
  // capacity arm inside it is the only thing that can refuse.
  const passPreChecks = () => {
    prismaMock.user.findFirst.mockResolvedValueOnce(null);
    prismaMock.badPassword.findUnique.mockResolvedValueOnce(null);
    prismaMock.userRank.findFirst.mockResolvedValueOnce(makeUserRank());
    prismaMock.$transaction.mockImplementationOnce(async (cb: unknown) =>
      (cb as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock)
    );
  };

  it('refuses with 403 and writes nothing when enabled accounts have reached maxUsers', async () => {
    settingsWith('open', 3);
    passPreChecks();
    prismaMock.user.count.mockResolvedValueOnce(3);

    const res = await request(app).post('/api/auth/register').send({
      username: 'late-user',
      email: 'late@example.com',
      password: 'password123'
    });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      msg: 'Registration is full: the site has reached its member limit.'
    });
    expect(prismaMock.user.count).toHaveBeenCalledWith({
      where: { disabled: false }
    });
    expect(prismaMock.userSettings.create).not.toHaveBeenCalled();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('takes the advisory lock before counting seats', async () => {
    settingsWith('open', 3);
    passPreChecks();
    prismaMock.user.count.mockResolvedValueOnce(3);

    await request(app).post('/api/auth/register').send({
      username: 'late-user',
      email: 'late@example.com',
      password: 'password123'
    });

    // Order is the whole design: a count taken before the lock is shared by
    // every concurrent caller. The integration test proves the lock works.
    const lockAt = prismaMock.$executeRaw.mock.invocationCallOrder[0];
    const countAt = prismaMock.user.count.mock.invocationCallOrder[0];
    expect(lockAt).toBeDefined();
    expect(lockAt).toBeLessThan(countAt);
  });

  it('tells an invitee when their invite expires, and leaves it pending', async () => {
    settingsWith('invite', 3);
    // The clock keeps running while the site is full (#627), so the message
    // names the expiry instead of promising the invite is still valid.
    const expires = new Date(Date.now() + 2 * 86_400_000);
    prismaMock.invite.findUnique.mockResolvedValueOnce({
      email: 'late@example.com',
      expires,
      inviter: { disabled: false, canInvite: true },
      status: 'pending'
    } as never);
    passPreChecks();
    prismaMock.user.count.mockResolvedValueOnce(3);

    const res = await request(app).post('/api/auth/register').send({
      username: 'late-user',
      email: 'late@example.com',
      password: 'password123',
      inviteKey: 'held-key'
    });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      msg: `Registration is full: the site has reached its member limit. Your invite is valid until ${expires.toUTCString()}.`
    });
    expect(prismaMock.invite.updateMany).not.toHaveBeenCalled();
  });

  it('admits the registration that takes the last seat', async () => {
    settingsWith('open', 3);
    passPreChecks();
    prismaMock.user.count.mockResolvedValueOnce(2);
    prismaMock.userSettings.create.mockResolvedValueOnce({ id: 4 } as never);
    prismaMock.profile.create.mockResolvedValueOnce({ id: 5 } as never);
    prismaMock.user.create.mockResolvedValueOnce(
      asUserMock({
        id: 13,
        username: 'last-user',
        email: 'last@example.com',
        password: 'hashed-password',
        avatar: null,
        isArtist: false,
        isDonor: false,
        canDownload: true,
        inviteCount: 0,
        contributed: BigInt(0),
        consumed: BigInt(0),
        ratio: 0,
        dateRegistered: '2026-09-14T00:00:00.000Z',
        lastLogin: null,
        userRank: {
          id: 1,
          level: 100,
          name: 'User',
          color: '',
          badge: '',
          permissions: {},
          personalCollageLimit: 0
        },
        secondaryRanks: [],
        warnings: []
      })
    );

    const res = await request(app).post('/api/auth/register').send({
      username: 'last-user',
      email: 'last@example.com',
      password: 'password123'
    });

    expect(res.status).toBe(201);
  });
});
