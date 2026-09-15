/**
 * A member's own invites at the route level (#640): the list of invites that
 * can still be used, and withdrawing one.
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
      email: 'typo@example.con'
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
