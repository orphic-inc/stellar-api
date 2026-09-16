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
  const result = await registerUser({
    username,
    email,
    password,
    registrationMode: 'open',
    maxUsers: 7000
  });
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error('Failed to register fixture user');
  }
  return result.user;
};

describe('registerUser', () => {
  it('creates user, userSettings, and profile in a single transaction', async () => {
    const result = await registerUser({
      username: 'alice',
      email: 'alice@example.com',
      password: 'password1',
      registrationMode: 'open',
      maxUsers: 7000
    });
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

    const result = await registerUser({
      username: 'alice',
      email: 'other@example.com',
      password: 'password1',
      registrationMode: 'open',
      maxUsers: 7000
    });
    expect(result).toEqual({ ok: false, reason: 'user_exists' });
  });

  it('stores password as a bcrypt hash, never plaintext', async () => {
    const result = await registerUser({
      username: 'bob',
      email: 'bob@example.com',
      password: 'password2',
      registrationMode: 'open',
      maxUsers: 7000
    });
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

/**
 * The session's ratio policy (#659) against a real database.
 *
 * `auth.spec.ts` casts its fixtures, so it proves the projection and nothing
 * about the query. These prove `authUserSelect` actually resolves the relation
 * — which is the half that breaks if the select or the schema moves.
 */
describe('the session carries ratio policy', () => {
  it('is null for a member with no policy row', async () => {
    const user = await registerFixtureUser(
      'carol',
      'carol@example.com',
      'password3'
    );
    expect(user.ratioPolicy).toBeNull();

    const result = await loginUser('carol@example.com', 'password3');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.ratioPolicy).toBeNull();
  });

  it('carries status, expiry and cause when a row exists', async () => {
    const user = await registerFixtureUser(
      'dave',
      'dave@example.com',
      'password4'
    );
    const expires = new Date('2026-12-01T00:00:00.000Z');
    await testPrisma.ratioPolicyState.create({
      data: {
        userId: user.id,
        status: 'WATCH',
        watchStartedAt: new Date('2026-11-17T00:00:00.000Z'),
        watchExpiresAt: expires
      }
    });

    const result = await loginUser('dave@example.com', 'password4');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.ratioPolicy).toEqual({
      status: 'WATCH',
      watchExpiresAt: expires,
      disabledCause: null
    });
  });

  it('carries the cause for a staff disable', async () => {
    const user = await registerFixtureUser(
      'erin',
      'erin@example.com',
      'password5'
    );
    await testPrisma.ratioPolicyState.create({
      data: {
        userId: user.id,
        status: 'DOWNLOAD_DISABLED',
        downloadDisabledAt: new Date(),
        disabledCause: 'STAFF'
      }
    });

    const result = await loginUser('erin@example.com', 'password5');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.ratioPolicy).toMatchObject({
      status: 'DOWNLOAD_DISABLED',
      disabledCause: 'STAFF'
    });
  });

  it('selects only the three fields the session needs', async () => {
    // Not `requiredRatio`, and not the rest of RatioPolicyState: the session is
    // read on every page, so widening this select has a site-wide cost.
    const user = await registerFixtureUser(
      'frank',
      'frank@example.com',
      'password6'
    );
    await testPrisma.ratioPolicyState.create({
      data: {
        userId: user.id,
        status: 'WATCH',
        watchStartedAt: new Date(),
        watchExpiresAt: new Date(),
        consumedAtWatchStart: BigInt(123)
      }
    });

    const result = await loginUser('frank@example.com', 'password6');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.user.ratioPolicy!).sort()).toEqual([
      'disabledCause',
      'status',
      'watchExpiresAt'
    ]);
  });
});
