/**
 * Integration coverage for the reactivation flow (#279, ADR-0038).
 *
 * These exercise the parts a mocked Prisma cannot vouch for: that the two token
 * purposes really are non-interchangeable in the database, and that a second
 * confirm appends to the open ticket rather than opening another. Both are
 * security-shaped, and both are single `where` clauses away from being wrong.
 */
import { RecoveryPurpose } from '@prisma/client';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import {
  registerUser,
  generateRecoveryToken,
  persistRecoveryToken,
  resetPasswordWithToken,
  confirmReactivation
} from '../modules/auth';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const makeDisabledUser = async () => {
  const result = await registerUser({
    username: 'dormant',
    email: 'dormant@example.com',
    password: 'password1',
    registrationMode: 'open'
  });
  if (!result.ok) throw new Error('fixture registration failed');
  await testPrisma.user.update({
    where: { id: result.user.id },
    data: { disabled: true }
  });
  return result.user.id;
};

describe('recovery token purposes are not interchangeable', () => {
  it('refuses a reactivation token at the password reset', async () => {
    const userId = await makeDisabledUser();
    const token = generateRecoveryToken();
    await persistRecoveryToken(userId, token, RecoveryPurpose.Reactivation);

    await expect(
      resetPasswordWithToken(token, 'a-brand-new-password')
    ).rejects.toThrow(/Invalid or expired/);

    // And it is still unspent, so the legitimate flow can still use it.
    const row = await testPrisma.accountRecovery.findUnique({
      where: { token }
    });
    expect(row?.usedAt).toBeNull();
  });

  it('refuses a password-reset token at the reactivation confirm', async () => {
    const userId = await makeDisabledUser();
    const token = generateRecoveryToken();
    await persistRecoveryToken(userId, token, RecoveryPurpose.PasswordReset);

    await expect(confirmReactivation(token)).rejects.toThrow(
      /Invalid or expired/
    );
    expect(await testPrisma.staffInboxConversation.count()).toBe(0);
  });

  it('defaults an unqualified token to PasswordReset', async () => {
    // Every pre-#279 row was written by this call signature, so the default is
    // what keeps their meaning intact.
    const userId = await makeDisabledUser();
    const token = generateRecoveryToken();
    await persistRecoveryToken(userId, token);

    const row = await testPrisma.accountRecovery.findUnique({
      where: { token }
    });
    expect(row?.purpose).toBe(RecoveryPurpose.PasswordReset);
  });

  it('expires only the same purpose when minting a new token', async () => {
    // Asking to be reinstated must not silently kill a password reset the
    // member is halfway through.
    const userId = await makeDisabledUser();
    const resetToken = generateRecoveryToken();
    await persistRecoveryToken(userId, resetToken);

    const reactivationToken = generateRecoveryToken();
    await persistRecoveryToken(
      userId,
      reactivationToken,
      RecoveryPurpose.Reactivation
    );

    const reset = await testPrisma.accountRecovery.findUnique({
      where: { token: resetToken }
    });
    expect(reset!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('confirmReactivation', () => {
  it('opens a staff ticket and spends the token', async () => {
    const userId = await makeDisabledUser();
    const token = generateRecoveryToken();
    await persistRecoveryToken(userId, token, RecoveryPurpose.Reactivation);

    await confirmReactivation(token);

    const tickets = await testPrisma.staffInboxConversation.findMany({
      include: { messages: true }
    });
    expect(tickets).toHaveLength(1);
    expect(tickets[0].subject).toBe('Reactivation request');
    expect(tickets[0].userId).toBe(userId);
    expect(tickets[0].messages).toHaveLength(1);

    const row = await testPrisma.accountRecovery.findUnique({
      where: { token }
    });
    expect(row?.usedAt).not.toBeNull();
  });

  it('appends to the open ticket rather than opening a second', async () => {
    const userId = await makeDisabledUser();

    for (let i = 0; i < 3; i += 1) {
      const token = generateRecoveryToken();
      await persistRecoveryToken(userId, token, RecoveryPurpose.Reactivation);
      await confirmReactivation(token);
    }

    const tickets = await testPrisma.staffInboxConversation.findMany({
      include: { messages: true }
    });
    // One thread, three messages — one email round-trip must not become an
    // unlimited supply of threads in the staff inbox.
    expect(tickets).toHaveLength(1);
    expect(tickets[0].messages).toHaveLength(3);
  });

  it('refuses a token it has already spent', async () => {
    const userId = await makeDisabledUser();
    const token = generateRecoveryToken();
    await persistRecoveryToken(userId, token, RecoveryPurpose.Reactivation);

    await confirmReactivation(token);
    await expect(confirmReactivation(token)).rejects.toThrow(
      /Invalid or expired/
    );
  });
});
