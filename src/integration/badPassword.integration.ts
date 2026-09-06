import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { registerUser } from '../modules/auth';
import { seedBadPasswords } from '../modules/badPasswords';

/**
 * The proof that the denylist is actually live (#536).
 *
 * A unit test with a mocked Prisma passes against the *broken* code — it
 * asserts that `isPasswordBanned` returns true when the query returns a row,
 * which was never the problem. The problem was that the table was empty in
 * every deployment, so the query never returned a row. Only a test that seeds
 * the real table and drives the real registration path can tell the difference.
 */
beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe('password denylist enforcement', () => {
  it('seeds the denylist and stamps the marker', async () => {
    await seedBadPasswords(testPrisma);

    const count = await testPrisma.badPassword.count();
    expect(count).toBeGreaterThan(200);

    const settings = await testPrisma.siteSettings.findUnique({
      where: { id: 1 }
    });
    expect(settings?.badPasswordsSeededAt).toBeInstanceOf(Date);
  });

  it('creates the site settings row when nothing else has', async () => {
    // truncateAll wipes site_settings and no migration replants it, so the seed
    // is frequently the first writer of that row. A plain update would throw
    // and a findFirst guard would silently no-op.
    expect(await testPrisma.siteSettings.findUnique({ where: { id: 1 } })).toBe(
      null
    );
    await seedBadPasswords(testPrisma);
    expect(
      await testPrisma.siteSettings.findUnique({ where: { id: 1 } })
    ).not.toBe(null);
  });

  it('refuses registration with a denied password', async () => {
    await seedBadPasswords(testPrisma);

    const result = await registerUser({
      username: 'weakling',
      email: 'weakling@example.com',
      password: 'password',
      registrationMode: 'open'
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('bad_password');
    expect(await testPrisma.user.count()).toBe(0);
  });

  it('refuses a denied password regardless of case', async () => {
    // The whole point of normalising both sides. Before this, a capital letter
    // walked straight past a 237-entry list.
    await seedBadPasswords(testPrisma);

    for (const attempt of ['PASSWORD', 'PaSsWoRd', 'QWERTY']) {
      const result = await registerUser({
        username: `user-${attempt}`,
        email: `${attempt}@example.com`,
        password: attempt,
        registrationMode: 'open'
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('bad_password');
    }
    expect(await testPrisma.user.count()).toBe(0);
  });

  it('still admits a password that is not on the list', async () => {
    await seedBadPasswords(testPrisma);

    const result = await registerUser({
      username: 'sensible',
      email: 'sensible@example.com',
      password: 'correct-horse-battery-staple',
      registrationMode: 'open'
    });

    expect(result.ok).toBe(true);
    expect(await testPrisma.user.count()).toBe(1);
  });

  it('does not resurrect a seeded row staff deleted', async () => {
    await seedBadPasswords(testPrisma);
    await testPrisma.badPassword.deleteMany({ where: { password: 'monkey' } });

    // A second seed stands in for the next container boot.
    await seedBadPasswords(testPrisma);

    const revived = await testPrisma.badPassword.findUnique({
      where: { password: 'monkey' }
    });
    expect(revived).toBe(null);
  });
});
