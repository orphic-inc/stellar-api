import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { registerUser, loginUser } from '../modules/auth';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const registerFixtureUser = async (
  username: string,
  email: string,
  password: string
) => {
  const result = await registerUser(username, email, password);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error('Failed to register fixture user');
  }
  return result.user;
};

describe('registerUser', () => {
  it('creates user, userSettings, and profile in a single transaction', async () => {
    const result = await registerUser(
      'alice',
      'alice@example.com',
      'password1'
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.user.username).toBe('alice');
    expect(result.user.email).toBe('alice@example.com');

    const dbUser = await testPrisma.user.findUnique({
      where: { id: result.user.id },
      include: { userSettings: true }
    });
    expect(dbUser).not.toBeNull();
    expect(dbUser!.userSettings).not.toBeNull();

    const profile = await testPrisma.profile.findUnique({
      where: { id: dbUser!.profileId }
    });
    expect(profile).not.toBeNull();
  });

  it('returns user_exists when username or email is already taken', async () => {
    await registerFixtureUser('alice', 'alice@example.com', 'password1');

    const result = await registerUser(
      'alice',
      'other@example.com',
      'password1'
    );
    expect(result).toEqual({ ok: false, reason: 'user_exists' });
  });

  it('stores password as a bcrypt hash, never plaintext', async () => {
    const result = await registerUser('bob', 'bob@example.com', 'password2');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const dbUser = await testPrisma.user.findUnique({
      where: { id: result.user.id }
    });
    expect(dbUser!.password).not.toBe('password2');
    expect(dbUser!.password).toMatch(/^\$2[ab]\$/);
  });
});

describe('loginUser', () => {
  it('returns not_found for an unknown email', async () => {
    const result = await loginUser('nobody@example.com', 'password1');
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('returns wrong_password for a bad password', async () => {
    await registerFixtureUser('alice', 'alice@example.com', 'password1');

    const result = await loginUser('alice@example.com', 'wrongpass');
    expect(result).toEqual({ ok: false, reason: 'wrong_password' });
  });

  it('returns disabled for a banned account', async () => {
    const user = await registerFixtureUser(
      'alice',
      'alice@example.com',
      'password1'
    );

    await testPrisma.user.update({
      where: { id: user.id },
      data: { disabled: true }
    });

    const result = await loginUser('alice@example.com', 'password1');
    expect(result).toEqual({ ok: false, reason: 'disabled' });
  });

  it('updates lastLogin on successful login', async () => {
    const user = await registerFixtureUser(
      'bob',
      'bob@example.com',
      'password2'
    );

    await testPrisma.user.update({
      where: { id: user.id },
      data: { disabled: false }
    });

    const before = new Date();
    const result = await loginUser('bob@example.com', 'password2');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.user.lastLogin!.getTime()).toBeGreaterThanOrEqual(
      before.getTime()
    );
  });
});
