/**
 * Unlimited invites at the route level (#637, ADR-0043 §5): the route resolves
 * `invites_unlimited` and passes it down, and every exit from `pending` that
 * refunds says so only when the invite was spent.
 *
 * What a mocked Prisma can show: which permission reaches `createInvite` and
 * the eligibility read, that an unspent invite's cancel or withdraw writes no
 * refund, and the words each answers. The same rules against a real database
 * are inviteUnlimited.integration.ts's.
 */
import {
  request,
  app,
  prismaMock,
  makeUserRank,
  resetApiTestState,
  setCurrentUserPermissions,
  createInviteMock
} from './test/apiTestHarness';
import { TEST_USER_ID } from './test/factories';
import { sendSystemMessage } from './modules/pm';

const sendSystemMessageMock = sendSystemMessage as jest.Mock;

const grant = (permissions: Record<string, boolean>) =>
  setCurrentUserPermissions(
    makeUserRank(permissions).permissions as Record<string, boolean>
  );

const auditMetadata = () =>
  (
    prismaMock.auditLog.create.mock.calls[0]?.[0] as {
      data: { metadata: Record<string, unknown> };
    }
  ).data.metadata;

/** A claimed pending invite that was sent without spending one. */
const claimedUnspent = (inviterId: number) => {
  prismaMock.invite.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.invite.findUniqueOrThrow.mockResolvedValue({
    inviterId,
    email: 'friend@example.com',
    spent: false
  } as never);
};

beforeEach(() => {
  resetApiTestState();
  prismaMock.$transaction.mockImplementation(async (cb: unknown) =>
    (cb as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock)
  );
  prismaMock.auditLog.create.mockResolvedValue({} as never);
  sendSystemMessageMock.mockResolvedValue({ ok: true });
});

describe('POST /api/profile/referral/create-invite', () => {
  const send = () =>
    request(app)
      .post('/api/profile/referral/create-invite')
      .send({ email: 'friend@example.com' });

  beforeEach(() => {
    createInviteMock.mockResolvedValue({
      ok: true,
      inviteKey: 'k',
      emailSent: true
    });
  });

  it.each([
    ['invites_unlimited', { invites_unlimited: true }, true],
    ['admin, which implies it', { admin: true }, true],
    ['neither', { invites_edit: true }, false]
  ])('passes unlimited from the rank for %s', async (_, perms, unlimited) => {
    grant(perms);

    expect((await send()).status).toBe(201);
    expect(createInviteMock).toHaveBeenCalledWith(
      TEST_USER_ID,
      'friend@example.com',
      '',
      { unlimited }
    );
  });
});

describe('GET /api/profile/me/invites/eligibility', () => {
  it('lets an unlimited member with no invites send, and says they are unlimited', async () => {
    grant({ invites_unlimited: true });
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({
      canInvite: true,
      canDownload: true,
      inviteCount: 0,
      banDate: null,
      dateRegistered: new Date('2025-01-01T00:00:00Z'),
      warnings: []
    } as never);
    prismaMock.ratioPolicyState.findUnique.mockResolvedValue(null);
    prismaMock.siteSettings.upsert.mockResolvedValue({ maxUsers: 50 } as never);
    prismaMock.user.count.mockResolvedValue(10);

    const res = await request(app).get('/api/profile/me/invites/eligibility');

    expect(res.body).toEqual({
      canSend: true,
      reason: null,
      msg: null,
      unlimited: true
    });
  });
});

describe('ending an unspent invite returns nothing', () => {
  it('withdraws it without a refund, and says so', async () => {
    claimedUnspent(TEST_USER_ID);

    const res = await request(app).post('/api/profile/me/invites/5/withdraw');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ msg: 'Invite withdrawn' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(auditMetadata()).toMatchObject({ refunded: false });
  });

  it('cancels it for staff without a refund, and the PM does not promise one', async () => {
    grant({ invites_edit: true });
    claimedUnspent(12);

    const res = await request(app)
      .post('/api/users/invites/5/cancel')
      .send({ reason: 'Sold on a forum', message: 'Please do not trade.' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ msg: 'Invite cancelled' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(auditMetadata()).toMatchObject({ refunded: false });
    expect(sendSystemMessageMock).toHaveBeenCalledWith(
      12,
      'An invite you sent was cancelled',
      'Please do not trade.\n\nYour invite to friend@example.com was ' +
        'cancelled.\n\nIf you have questions, contact staff through Staff PM: ' +
        '/inbox/staff'
    );
  });
});
