import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { registerUser } from '../modules/auth';

/**
 * The proof the blacklist is actually read (#540).
 *
 * A unit test with a mocked Prisma passes against the *broken* code — it
 * asserts the matcher returns true when the query returns a row, which was
 * never the problem. The problem was that no code path ran the query at all.
 * Only a test that inserts a real row and drives the real registration path can
 * tell the difference.
 */
beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const blacklist = (email: string) =>
  testPrisma.emailBlacklist.create({
    data: { userId: 1, email, comment: 'test', addedAt: new Date() }
  });

const register = (username: string, email: string) =>
  registerUser({
    username,
    email,
    password: 'correct-horse-battery-staple',
    registrationMode: 'open'
  });

describe('email blacklist enforcement', () => {
  it('refuses registration for a blacklisted address', async () => {
    await blacklist('spammer@example.com');

    const result = await register('spammer', 'spammer@example.com');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('email_blacklisted');
    expect(await testPrisma.user.count()).toBe(0);
  });

  it('refuses every address at a blacklisted domain', async () => {
    // The admin route's own validation message has always promised "Email or
    // domain", so a domain entry has to actually work.
    await blacklist('spam.example');

    for (const who of ['alice', 'bob']) {
      const result = await register(who, `${who}@spam.example`);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('email_blacklisted');
    }
    expect(await testPrisma.user.count()).toBe(0);
  });

  it('matches regardless of the case the address is submitted in', async () => {
    await blacklist('spammer@example.com');

    const result = await register('shouty', 'SPAMMER@EXAMPLE.COM');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('email_blacklisted');
  });

  it('does not treat a domain entry as matching its subdomains', async () => {
    // Literal matching: banning example.com must not silently ban
    // @mail.example.com, which is a different mail domain.
    await blacklist('example.com');

    const result = await register('sub', 'user@mail.example.com');

    expect(result.ok).toBe(true);
  });

  it('admits an address that is not blacklisted', async () => {
    await blacklist('spam.example');

    const result = await register('legit', 'legit@good.example');

    expect(result.ok).toBe(true);
    expect(await testPrisma.user.count()).toBe(1);
  });
});
