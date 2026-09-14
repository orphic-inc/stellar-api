/**
 * Invite expiry at the registration route (#627, ADR-0041). Its own file, like
 * registrationCapacity.spec.ts, because install-auth.spec.ts is past the size
 * Codacy flags.
 *
 * What a mocked Prisma can show: the refusal message, and that accepting an
 * invite is a CLAIM whose failure rolls the registration back. The claim racing
 * a real sweep is inviteExpiry.integration.ts's job.
 */
import {
  request,
  app,
  prismaMock,
  makeUserRank,
  resetApiTestState
} from './test/apiTestHarness';
import { asUserMock } from './test/factories';

const EXPIRED_MSG =
  'This invite has expired. Ask the member who invited you to send a new one.';

const body = {
  username: 'invitee',
  email: 'invitee@example.com',
  password: 'password123',
  inviteKey: 'the-key'
};

const createdUser = () =>
  asUserMock({
    id: 14,
    username: 'invitee',
    email: 'invitee@example.com',
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
    secondaryRanks: []
  });

describe('POST /api/auth/register — invite expiry (#627)', () => {
  beforeEach(() => {
    resetApiTestState();
    prismaMock.siteSettings.upsert.mockResolvedValue({
      id: 1,
      approvedDomains: [],
      registrationStatus: 'invite',
      maxUsers: 7000,
      dismissedLaunchChecklist: [],
      installedAt: null,
      badPasswordsSeededAt: null,
      updatedAt: new Date()
    });
  });

  const inviteRow = (over: Record<string, unknown> = {}) =>
    prismaMock.invite.findUnique.mockResolvedValueOnce({
      email: 'invitee@example.com',
      status: 'pending',
      expires: new Date(Date.now() + 86_400_000),
      inviter: { disabled: false },
      ...over
    } as never);

  it.each([
    ['past its expiry', { expires: new Date(Date.now() - 1000) }],
    ['from a disabled inviter', { inviter: { disabled: true } }],
    ['already marked expired', { status: 'expired' }]
  ])('refuses an invite %s with the expired message', async (_, over) => {
    inviteRow(over);

    const res = await request(app).post('/api/auth/register').send(body);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ msg: EXPIRED_MSG });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('checks the email before the lapse, so a key that is not yours reveals nothing', async () => {
    inviteRow({
      email: 'someone-else@example.com',
      expires: new Date(Date.now() - 1000)
    });

    const res = await request(app).post('/api/auth/register').send(body);

    expect(res.body).toEqual({
      msg: 'Invite key is not valid for this email address'
    });
  });

  it('rolls the registration back when the invite lapses before it is claimed', async () => {
    // Live at the pre-check; the sweep takes it before the transaction's claim.
    inviteRow();
    prismaMock.user.findFirst.mockResolvedValueOnce(null);
    prismaMock.badPassword.findUnique.mockResolvedValueOnce(null);
    prismaMock.userRank.findFirst.mockResolvedValueOnce(makeUserRank());
    prismaMock.$transaction.mockImplementationOnce(async (cb: unknown) =>
      (cb as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock)
    );
    prismaMock.user.count.mockResolvedValueOnce(1);
    prismaMock.userSettings.create.mockResolvedValueOnce({ id: 4 } as never);
    prismaMock.profile.create.mockResolvedValueOnce({ id: 5 } as never);
    prismaMock.user.create.mockResolvedValueOnce(createdUser());
    prismaMock.invite.updateMany.mockResolvedValueOnce({ count: 0 });

    const res = await request(app).post('/api/auth/register').send(body);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ msg: EXPIRED_MSG });
    // The claim re-states the live predicate at write time; a plain update by
    // key would accept an invite the sweep has already refunded.
    expect(prismaMock.invite.updateMany).toHaveBeenCalledWith({
      where: {
        inviteKey: 'the-key',
        status: 'pending',
        expires: { gt: expect.any(Date) },
        inviter: { disabled: false }
      },
      data: { status: 'accepted' }
    });
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});
