/**
 * Integration coverage for the recovery token's `purpose` column (ADR-0038 §2).
 *
 * #279 added a Reactivation purpose beside PasswordReset; #629 withdrew it. The
 * column stays, so the reset still filters on it — and a mocked Prisma cannot
 * vouch that what `persistRecoveryToken` writes is what `resetPasswordWithToken`
 * reads. If those two ever disagree, every password reset fails.
 */
import { RecoveryPurpose } from '@prisma/client';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import {
  registerUser,
  generateRecoveryToken,
  persistRecoveryToken,
  resetPasswordWithToken
} from '../modules/auth';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const makeUser = async () => {
  const result = await registerUser({
    username: 'forgetful',
    email: 'forgetful@example.com',
    password: 'password1',
    registrationMode: 'open',
    maxUsers: 7000
  });
  if (!result.ok) throw new Error('fixture registration failed');
  return result.user.id;
};

describe('recovery token purpose', () => {
  it('mints a PasswordReset token that the reset accepts and spends', async () => {
    const userId = await makeUser();
    const token = generateRecoveryToken();
    await persistRecoveryToken(userId, token);

    const minted = await testPrisma.accountRecovery.findUnique({
      where: { token }
    });
    expect(minted?.purpose).toBe(RecoveryPurpose.PasswordReset);

    await resetPasswordWithToken(token, 'a-brand-new-password');

    const spent = await testPrisma.accountRecovery.findUnique({
      where: { token }
    });
    expect(spent?.usedAt).not.toBeNull();
  });

  it('expires the pending token when a new one is minted', async () => {
    const userId = await makeUser();
    const first = generateRecoveryToken();
    await persistRecoveryToken(userId, first);
    await persistRecoveryToken(userId, generateRecoveryToken());

    await expect(
      resetPasswordWithToken(first, 'a-brand-new-password')
    ).rejects.toThrow(/Invalid or expired/);
  });
});
