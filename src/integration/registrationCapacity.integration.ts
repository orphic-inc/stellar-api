/**
 * Integration coverage for enforced capacity (#624, ADR-0040).
 *
 * The concurrent case is the reason this file exists. A mocked Prisma can show
 * that `registerUser` takes a lock before it counts; only a real database can
 * show the lock makes the last seat go to exactly one caller. Without it every
 * concurrent caller reads the same free seat under READ COMMITTED.
 */
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { registerUser } from '../modules/auth';
import { createUser } from '../modules/user';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const seats = () => testPrisma.user.count({ where: { disabled: false } });

const register = (
  n: number | string,
  maxUsers: number,
  extra: { registrationMode?: 'open' | 'invite'; inviteKey?: string } = {}
) =>
  registerUser({
    username: `member${n}`,
    email: `member${n}@example.com`,
    password: 'password1',
    registrationMode: 'open',
    maxUsers,
    ...extra
  });

describe('registerUser capacity', () => {
  it('refuses once enabled accounts reach maxUsers, and creates no row', async () => {
    const taken = await seats();
    expect((await register(1, taken + 1)).ok).toBe(true);

    const refused = await register(2, taken + 1);

    expect(refused).toEqual({ ok: false, reason: 'registration_full' });
    expect(
      await testPrisma.user.findFirst({ where: { username: 'member2' } })
    ).toBeNull();
    expect(await seats()).toBe(taken + 1);
  });

  it('leaves a presented invite pending when the site is full', async () => {
    const taken = await seats();
    const inviter = await register('inviter', taken + 1);
    if (!inviter.ok) throw new Error('fixture registration failed');
    const invite0 = await testPrisma.invite.create({
      data: {
        inviterId: inviter.user.id,
        inviteKey: 'held-key',
        email: 'member2@example.com',
        expires: new Date(Date.now() + 86_400_000)
      }
    });

    const refused = await register(2, taken + 1, {
      registrationMode: 'invite',
      inviteKey: 'held-key'
    });

    // The clock keeps running while full (#627), so the refusal carries the
    // expiry for the message to name.
    expect(refused).toEqual({
      ok: false,
      reason: 'registration_full',
      inviteExpires: new Date(invite0.expires)
    });
    const invite = await testPrisma.invite.findUnique({
      where: { inviteKey: 'held-key' }
    });
    expect(invite?.status).toBe('pending');
  });

  it('does not count disabled accounts as seats', async () => {
    const taken = await seats();
    const first = await register(1, taken + 1);
    if (!first.ok) throw new Error('fixture registration failed');
    await testPrisma.user.update({
      where: { id: first.user.id },
      data: { disabled: true }
    });

    expect((await register(2, taken + 1)).ok).toBe(true);
  });

  it('gives the last seat to exactly one of many concurrent registrations', async () => {
    const taken = await seats();
    const CALLERS = 12;

    const results = await Promise.all(
      Array.from({ length: CALLERS }, (_, i) => register(i, taken + 1))
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(
      results.filter((r) => !r.ok && r.reason === 'registration_full')
    ).toHaveLength(CALLERS - 1);
    expect(await seats()).toBe(taken + 1);
  });
});

describe('staff account creation', () => {
  it('is not capped: POST /api/users creates past a full site', async () => {
    const taken = await seats();
    const staff = await register('staff', taken + 1);
    if (!staff.ok) throw new Error('fixture registration failed');
    expect((await register(2, taken + 1)).ok).toBe(false);

    await createUser(
      {
        username: 'onboarded',
        email: 'onboarded@example.com',
        password: 'password1'
      },
      staff.user.id
    );

    expect(await seats()).toBe(taken + 2);
  });
});
