/**
 * The inviter, a same-IP flag and per-IP account counts in the staff
 * registration log (#850, grilled on #638).
 *
 * Against a real database, because the counts come from a grouped read.
 */

import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { getRegistrationLog } from '../modules/registrationLog';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

let seq = 0;
const tag = (prefix: string) => `${prefix}-${Date.now()}-${seq++}`;
const PAGE = { page: 1, limit: 50, skip: 0 };

// Registration dates are spaced out so the log's newest-first order is fixed.
const createUser = async (
  name: string,
  opts: { lastIp?: string | null; inviterId?: number } = {}
) => {
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const userSettings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  return testPrisma.user.create({
    data: {
      username: tag(name),
      email: `${tag(name)}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: userSettings.id,
      profileId: profile.id,
      lastIp: opts.lastIp ?? null,
      dateRegistered: new Date(Date.UTC(2026, 0, 1 + seq)),
      inviteTree: { create: { inviterId: opts.inviterId ?? null } }
    }
  });
};

const rowFor = async (userId: number) => {
  const { rows } = await getRegistrationLog(PAGE);
  const row = rows.find((r) => r.id === userId);
  if (!row) throw new Error(`no row for ${userId}`);
  return row;
};

describe('registration log inviter (#850)', () => {
  it("gives the inviter the invitee's projection, with its own IP count", async () => {
    const inviter = await createUser('inviter', { lastIp: '203.0.113.9' });
    const invitee = await createUser('invitee', {
      lastIp: '198.51.100.1',
      inviterId: inviter.id
    });

    const row = await rowFor(invitee.id);

    expect(row.inviter).toEqual({
      id: inviter.id,
      username: inviter.username,
      email: inviter.email,
      dateRegistered: inviter.dateRegistered,
      disabled: false,
      lastIp: '203.0.113.9',
      lastIpAccounts: 1,
      userRank: expect.objectContaining({ id: inviter.userRankId })
    });
    expect(row.sameIp).toBe(false);
  });

  it('answers a null inviter for an account nobody invited', async () => {
    const member = await createUser('member', { lastIp: '198.51.100.1' });

    const row = await rowFor(member.id);

    expect(row.inviter).toBeNull();
    expect(row.sameIp).toBe(false);
  });

  it('flags an invitee on its inviter’s current IP', async () => {
    const inviter = await createUser('inviter', { lastIp: '198.51.100.7' });
    const invitee = await createUser('invitee', {
      lastIp: '198.51.100.7',
      inviterId: inviter.id
    });

    const row = await rowFor(invitee.id);

    expect(row.sameIp).toBe(true);
    // The shared IP is counted once per account, on both halves.
    expect(row.lastIpAccounts).toBe(2);
    expect(row.inviter?.lastIpAccounts).toBe(2);
  });

  it('does not flag two accounts that both lack an IP', async () => {
    const inviter = await createUser('inviter');
    const invitee = await createUser('invitee', { inviterId: inviter.id });

    const row = await rowFor(invitee.id);

    expect(row.sameIp).toBe(false);
    expect(row.lastIpAccounts).toBeNull();
    expect(row.inviter?.lastIpAccounts).toBeNull();
  });

  it('does not flag an invitee with an IP when its inviter has none', async () => {
    const inviter = await createUser('inviter');
    const invitee = await createUser('invitee', {
      lastIp: '198.51.100.1',
      inviterId: inviter.id
    });

    expect((await rowFor(invitee.id)).sameIp).toBe(false);
  });

  it('counts every account on an IP, including ones off the page', async () => {
    await createUser('neighbour', { lastIp: '192.0.2.4' });
    await createUser('neighbour', { lastIp: '192.0.2.4' });
    const member = await createUser('member', { lastIp: '192.0.2.4' });

    const { rows } = await getRegistrationLog({ page: 1, limit: 1, skip: 0 });

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(member.id);
    expect(rows[0].lastIpAccounts).toBe(3);
  });
});
