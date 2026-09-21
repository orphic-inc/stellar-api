/**
 * A member's own invites at the route level (#640): the list of invites that
 * can still be used, and withdrawing one. Also whether they can send one at all
 * (#637).
 *
 * What a mocked Prisma can show: that the list uses the live predicate and is
 * scoped to the caller, that the withdraw is the shared cancel claim scoped to
 * the caller's own invites, and the status each outcome answers. The same rules
 * against a real database are inviteControls.integration.ts's.
 */
import {
  request,
  app,
  prismaMock,
  resetApiTestState
} from './test/apiTestHarness';
import { TEST_USER_ID } from './test/factories';
import { sendSystemMessage } from './modules/pm';

beforeEach(() => {
  resetApiTestState();
  prismaMock.$transaction.mockImplementation(async (cb: unknown) =>
    (cb as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock)
  );
  prismaMock.auditLog.create.mockResolvedValue({} as never);
});

describe('GET /api/profile/me/invites/eligibility', () => {
  const member = (overrides: Record<string, unknown> = {}) => {
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({
      canInvite: true,
      canDownload: true,
      inviteCount: 2,
      banDate: null,
      dateRegistered: new Date('2025-01-01T00:00:00Z'),
      warnings: [],
      ...overrides
    } as never);
    prismaMock.ratioPolicyState.findUnique.mockResolvedValue(null);
    prismaMock.siteSettings.upsert.mockResolvedValue({
      maxUsers: 50,
      registrationStatus: 'open'
    } as never);
    prismaMock.user.count.mockResolvedValue(10);
  };

  it('answers canSend with no reason when every gate is open', async () => {
    member();

    const res = await request(app).get('/api/profile/me/invites/eligibility');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      canSend: true,
      reason: null,
      msg: null,
      unlimited: false
    });
    // The caller's own state, never another member's.
    expect(prismaMock.user.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: TEST_USER_ID } })
    );
    expect(prismaMock.ratioPolicyState.findUnique).toHaveBeenCalledWith({
      where: { userId: TEST_USER_ID },
      select: { status: true }
    });
  });

  it('answers the first refusal with the words the send would use', async () => {
    member({ canDownload: false, inviteCount: 0 });
    prismaMock.user.count.mockResolvedValue(50);

    const res = await request(app).get('/api/profile/me/invites/eligibility');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      canSend: false,
      reason: 'downloads_disabled',
      msg: 'Your download access is disabled, so invites cannot be sent. Your invite was not used. Contact staff through Staff PM: /inbox/staff',
      unlimited: false
    });
  });

  // #673. The wiring, not the order: the pure module is pinned in
  // inviteGates.spec.ts, and what can only break here is the read that feeds
  // it — that the status comes from settings at all.
  it('refuses a closed site, in the words the send would use', async () => {
    member();
    prismaMock.siteSettings.upsert.mockResolvedValue({
      maxUsers: 50,
      registrationStatus: 'closed'
    } as never);

    const res = await request(app).get('/api/profile/me/invites/eligibility');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      canSend: false,
      reason: 'registration_closed',
      msg: 'Registration is currently closed, so invites cannot be sent right now. Your invite was not used.',
      unlimited: false
    });
  });

  // A closed site and a full one are different facts with different remedies:
  // a seat frees on its own, a closure waits on an operator. Naming the full
  // one here would tell the member to wait for something that will not help.
  it('names the closure over the capacity when a closed site is also full', async () => {
    member();
    prismaMock.siteSettings.upsert.mockResolvedValue({
      maxUsers: 50,
      registrationStatus: 'closed'
    } as never);
    prismaMock.user.count.mockResolvedValue(50);

    const res = await request(app).get('/api/profile/me/invites/eligibility');

    expect(res.body.reason).toBe('registration_closed');
  });

  // The gate is 'closed' alone. An invite-only site is the one that needs
  // invites most, so a later `!== 'open'` would break precisely the sites the
  // feature exists for — and nothing else in the suite would notice.
  it.each(['open', 'invite'] as const)(
    'lets a member of a %s site send',
    async (registrationStatus) => {
      member();
      prismaMock.siteSettings.upsert.mockResolvedValue({
        maxUsers: 50,
        registrationStatus
      } as never);

      const res = await request(app).get('/api/profile/me/invites/eligibility');

      expect(res.body).toMatchObject({ canSend: true, reason: null });
    }
  );

  // getSettings is an upsert. isSiteFull loads settings itself when given no
  // cap, so the careless wiring doubles a write on every poll of this route.
  it('reads settings once, handing the cap to the capacity check', async () => {
    member();

    await request(app).get('/api/profile/me/invites/eligibility');

    expect(prismaMock.siteSettings.upsert).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/profile/me/invites', () => {
  it('lists only your live pending invites, soonest to lapse first', async () => {
    const row = {
      id: 3,
      email: 'friend@example.com',
      reason: 'Old bandmate',
      createdAt: new Date('2026-09-14T00:00:00Z'),
      expires: new Date('2026-09-17T00:00:00Z')
    };
    prismaMock.invite.findMany.mockResolvedValue([row] as never);
    prismaMock.invite.count.mockResolvedValue(1);

    const res = await request(app).get('/api/profile/me/invites?limit=10');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      {
        ...row,
        createdAt: '2026-09-14T00:00:00.000Z',
        expires: '2026-09-17T00:00:00.000Z'
      }
    ]);
    expect(res.body.meta).toMatchObject({ total: 1, limit: 10 });
    const where = {
      status: 'pending',
      expires: { gt: expect.any(Date) },
      inviter: { disabled: false, canInvite: true },
      inviterId: TEST_USER_ID
    };
    expect(prismaMock.invite.findMany).toHaveBeenCalledWith({
      where,
      // No inviteKey, inviter or status: see OwnInviteItem.
      select: {
        id: true,
        email: true,
        reason: true,
        createdAt: true,
        expires: true
      },
      orderBy: [{ expires: 'asc' }, { id: 'asc' }],
      skip: 0,
      take: 10
    });
    expect(prismaMock.invite.count).toHaveBeenCalledWith({ where });
  });
});

describe('POST /api/profile/me/invites/:inviteId/withdraw', () => {
  it('claims your pending invite, refunds you and audits it, without a PM', async () => {
    prismaMock.invite.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.invite.findUniqueOrThrow.mockResolvedValue({
      inviterId: TEST_USER_ID,
      email: 'typo@example.con',
      spent: true
    } as never);
    prismaMock.user.update.mockResolvedValue({} as never);

    const res = await request(app).post('/api/profile/me/invites/5/withdraw');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ msg: 'Invite withdrawn and returned to you' });
    // Scoped to the caller: nobody can withdraw, or be refunded for, another
    // member's invite.
    expect(prismaMock.invite.updateMany).toHaveBeenCalledWith({
      where: { id: 5, status: 'pending', inviterId: TEST_USER_ID },
      data: { status: 'cancelled' }
    });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: TEST_USER_ID },
      data: { inviteCount: { increment: 1 } }
    });
    const { data } = prismaMock.auditLog.create.mock.calls[0]?.[0] as {
      data: { action: string; actorId: number; metadata: unknown };
    };
    expect(data).toMatchObject({
      action: 'invite.cancelled',
      actorId: TEST_USER_ID,
      metadata: {
        by: 'inviter',
        inviterId: TEST_USER_ID,
        email: 'typo@example.con',
        refunded: true
      }
    });
    expect(sendSystemMessage).not.toHaveBeenCalled();
  });

  it('answers 404 for an invite that is not yours, re-reading only your own', async () => {
    prismaMock.invite.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.invite.findFirst.mockResolvedValue(null);

    const res = await request(app).post('/api/profile/me/invites/5/withdraw');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'Invite not found' });
    expect(prismaMock.invite.findFirst).toHaveBeenCalledWith({
      where: { id: 5, inviterId: TEST_USER_ID },
      select: { id: true }
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('answers 409 for your invite once it is no longer pending', async () => {
    prismaMock.invite.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.invite.findFirst.mockResolvedValue({ id: 5 } as never);

    const res = await request(app).post('/api/profile/me/invites/5/withdraw');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ msg: 'This invite is no longer pending' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('answers 400 for an id that is not a positive integer', async () => {
    const res = await request(app).post('/api/profile/me/invites/abc/withdraw');
    expect(res.status).toBe(400);
  });
});
