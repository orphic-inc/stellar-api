/**
 * The invite note at the send (#851, grilled on #638): only `invites_note` may
 * write one, because it is carried to the invitee as a staff record. Anyone
 * else's note is dropped rather than refused, so the invite still goes out.
 *
 * The carry at registration is inviteNote.integration.ts's.
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

const grant = (permissions: Record<string, boolean>) =>
  setCurrentUserPermissions(
    makeUserRank(permissions).permissions as Record<string, boolean>
  );

beforeEach(() => {
  resetApiTestState();
  prismaMock.auditLog.create.mockResolvedValue({} as never);
  createInviteMock.mockResolvedValue({
    ok: true,
    inviteKey: 'k',
    emailSent: true
  });
});

const send = (body: Record<string, string>) =>
  request(app)
    .post('/api/profile/referral/create-invite')
    .send({ email: 'friend@example.com', ...body });

describe('POST /api/profile/referral/create-invite — the note (#851)', () => {
  it.each([
    ['invites_note', { invites_note: true }, 'Vouched for'],
    ['admin, which implies it', { admin: true }, 'Vouched for'],
    ['neither', { invites_manage: true }, '']
  ])('keeps the note only for %s', async (_, perms, note) => {
    grant(perms);

    expect((await send({ reason: 'Vouched for' })).status).toBe(201);
    expect(createInviteMock).toHaveBeenCalledWith(
      TEST_USER_ID,
      'friend@example.com',
      note,
      expect.anything()
    );
  });

  it('sends a holder without a note an empty one', async () => {
    grant({ invites_note: true });

    expect((await send({})).status).toBe(201);
    expect(createInviteMock).toHaveBeenCalledWith(
      TEST_USER_ID,
      'friend@example.com',
      '',
      { unlimited: false }
    );
  });
});
