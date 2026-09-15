/**
 * Staff invite controls at the route level (#636): revoking invite privileges
 * and setting the invite count. Its own file because moderation.spec.ts is past
 * the size Codacy flags.
 *
 * What a mocked Prisma can show: the shape of each write (the count edit must
 * stay a compare-and-set), the audit row, when the member is PMed, and the
 * status each outcome answers. The send refusal and the lapse of a revoked
 * member's invites against a real database are inviteExpiry.integration.ts's.
 */
import {
  request,
  app,
  prismaMock,
  makeUserRank,
  resetApiTestState,
  setCurrentUserPermissions
} from './test/apiTestHarness';
import { sendSystemMessage } from './modules/pm';

const sendSystemMessageMock = sendSystemMessage as jest.Mock;

const STAFF_PM_LINE =
  'If you have questions, contact staff through Staff PM: /inbox/staff';

const grant = (permissions: Record<string, boolean>) =>
  setCurrentUserPermissions(
    makeUserRank(permissions).permissions as Record<string, boolean>
  );

const auditMetadata = () =>
  (
    prismaMock.auditLog.create.mock.calls[0]?.[0] as {
      data: { action: string; metadata: Record<string, unknown> };
    }
  ).data;

beforeEach(() => {
  resetApiTestState();
  grant({ invites_edit: true });
  prismaMock.$transaction.mockImplementation(async (cb: unknown) =>
    (cb as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock)
  );
  prismaMock.auditLog.create.mockResolvedValue({} as never);
  sendSystemMessageMock.mockResolvedValue({ ok: true });
});

describe('PUT /api/users/:id/can-invite', () => {
  const revoke = { canInvite: false, reason: 'Invited two ban evaders' };

  it('revokes, keeps the balance, and records it for staff', async () => {
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({
      inviteCount: 3
    } as never);

    const res = await request(app).put('/api/users/9/can-invite').send(revoke);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ msg: 'Invite privileges revoked' });
    // Only the flag is written: the balance is kept, inert while revoked.
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { canInvite: false }
    });
    expect(auditMetadata()).toMatchObject({
      action: 'user.can_invite_changed',
      metadata: {
        canInvite: false,
        reason: 'Invited two ban evaders',
        inviteCount: 3,
        messaged: false
      }
    });
    expect(sendSystemMessageMock).not.toHaveBeenCalled();
  });

  it('restores, and PMs the member the message rather than the staff reason', async () => {
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({
      inviteCount: 0
    } as never);

    const res = await request(app).put('/api/users/9/can-invite').send({
      canInvite: true,
      reason: 'Appeal upheld',
      message: 'You can invite again.'
    });

    expect(res.body).toEqual({ msg: 'Invite privileges restored' });
    expect(sendSystemMessageMock).toHaveBeenCalledWith(
      9,
      'Your invite privileges have been restored',
      `You can invite again.\n\n${STAFF_PM_LINE}`
    );
    const { metadata } = auditMetadata();
    expect(metadata.messaged).toBe(true);
    expect(JSON.stringify(metadata)).not.toContain('You can invite again.');
  });

  it('still answers 200 when the PM fails, because the change has committed', async () => {
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({
      inviteCount: 0
    } as never);
    sendSystemMessageMock.mockRejectedValue(new Error('smtp down'));

    const res = await request(app)
      .put('/api/users/9/can-invite')
      .send({ ...revoke, message: 'Your invites are paused.' });

    expect(res.status).toBe(200);
  });

  it('answers 404 for a missing member, and neither audits nor PMs', async () => {
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(app)
      .put('/api/users/9/can-invite')
      .send({ ...revoke, message: 'x' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'User not found' });
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    expect(sendSystemMessageMock).not.toHaveBeenCalled();
  });

  it('requires invites_edit — viewing the pool is not enough', async () => {
    grant({ invites_manage: true });
    const res = await request(app).put('/api/users/9/can-invite').send(revoke);
    expect(res.status).toBe(403);
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['no reason', { canInvite: false }],
    ['a blank reason', { canInvite: false, reason: '   ' }],
    ['no flag', { reason: 'x' }]
  ])('answers 400 for %s', async (_, body) => {
    const res = await request(app).put('/api/users/9/can-invite').send(body);
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/users/:id/invite-count', () => {
  const edit = {
    inviteCount: 5,
    expectedInviteCount: 3,
    reason: 'Recruiting drive bonus'
  };

  it('writes a compare-and-set against the count the caller saw', async () => {
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app).put('/api/users/9/invite-count').send(edit);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ msg: 'Invite count updated' });
    // Never an unconditional set: a refund landing while the form was open
    // must fail this write, not be erased by it.
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: 9, inviteCount: 3 },
      data: { inviteCount: 5 }
    });
    expect(auditMetadata()).toMatchObject({
      action: 'user.invite_count_changed',
      metadata: {
        from: 3,
        to: 5,
        reason: 'Recruiting drive bonus',
        messaged: false
      }
    });
    expect(sendSystemMessageMock).not.toHaveBeenCalled();
  });

  it('PMs the new balance only, never the old one', async () => {
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });

    await request(app)
      .put('/api/users/9/invite-count')
      .send({ ...edit, inviteCount: 1, message: 'A thank-you.' });

    expect(sendSystemMessageMock).toHaveBeenCalledWith(
      9,
      'Your invite count was changed',
      `A thank-you.\n\nYou now have 1 invite.\n\n${STAFF_PM_LINE}`
    );
  });

  it('answers 409 when the balance moved since it was read', async () => {
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.user.findUnique.mockResolvedValue({ id: 9 } as never);

    const res = await request(app)
      .put('/api/users/9/invite-count')
      .send({ ...edit, message: 'x' });

    expect(res.status).toBe(409);
    expect(res.body.msg).toMatch(/changed since you loaded it/);
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    expect(sendSystemMessageMock).not.toHaveBeenCalled();
  });

  it('answers 404 when the member does not exist', async () => {
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await request(app).put('/api/users/9/invite-count').send(edit);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'User not found' });
  });

  it('accepts the ceiling, which is not tied to the rank cap', async () => {
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
    const res = await request(app)
      .put('/api/users/9/invite-count')
      .send({ ...edit, inviteCount: 1000 });
    expect(res.status).toBe(200);
  });

  it.each([
    ['a count over 1000', { ...edit, inviteCount: 1001 }],
    ['a negative count', { ...edit, inviteCount: -1 }],
    ['a fractional count', { ...edit, inviteCount: 2.5 }],
    ['no expected count', { inviteCount: 5, reason: 'x' }],
    ['no reason', { inviteCount: 5, expectedInviteCount: 3 }]
  ])('answers 400 for %s', async (_, body) => {
    const res = await request(app).put('/api/users/9/invite-count').send(body);
    expect(res.status).toBe(400);
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it('requires invites_edit', async () => {
    grant({ users_edit: true, invites_manage: true });
    const res = await request(app).put('/api/users/9/invite-count').send(edit);
    expect(res.status).toBe(403);
  });
});
