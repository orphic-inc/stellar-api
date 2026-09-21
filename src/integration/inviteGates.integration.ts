/**
 * Integration coverage for the invite send gates (#637, ADR-0043).
 *
 * The order itself is pinned in inviteGates.spec.ts. What only a database can
 * vouch for: that `createInvite` loads each gate's real inputs — active versus
 * expired warning rows, a `WATCH` row read together with the live ratio, the
 * seat count — that a refusal spends nothing and writes nothing, and that the
 * spend's claim holds `canDownload` on its own, apart from the pre-check that
 * would otherwise hide it.
 */
import {
  truncateAll,
  seedDefaults,
  testPrisma,
  openRegistration
} from '../test/dbHelpers';
import { createInvite, inviteSpendWhere } from '../modules/invite';
import { DAY_MS } from '../modules/inviteGrant';
import { DEFAULTS } from '../modules/settings';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
  // DEFAULTS is `closed`; createInvite reads it (#673).
  await openRegistration();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const GiB = BigInt(1024 ** 3);

let seq = 0;
const mkUser = async (
  opts: {
    inviteCount?: number;
    canInvite?: boolean;
    canDownload?: boolean;
    contributed?: bigint;
    consumed?: bigint;
  } = {}
) => {
  seq += 1;
  const rank =
    (await testPrisma.userRank.findFirst({ where: { level: 100 } })) ??
    (await testPrisma.userRank.create({
      data: { level: 100, name: 'rank-100', permissions: {} }
    }));
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  return testPrisma.user.create({
    data: {
      username: `it-gates-${seq}`,
      email: `it-gates-${seq}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id,
      inviteCount: opts.inviteCount ?? 1,
      canInvite: opts.canInvite ?? true,
      canDownload: opts.canDownload ?? true,
      contributed: opts.contributed ?? 0n,
      consumed: opts.consumed ?? 0n
    }
  });
};

const warn = async (userId: number, expiresInMs: number, count: number) => {
  const staff = await mkUser();
  for (let i = 0; i < count; i += 1) {
    await testPrisma.userWarning.create({
      data: {
        userId,
        warnedById: staff.id,
        reason: 'test',
        expiresAt: new Date(Date.now() + expiresInMs)
      }
    });
  }
};

const watch = (userId: number) =>
  testPrisma.ratioPolicyState.create({ data: { userId, status: 'WATCH' } });

/** Set the cap to the seats already taken. */
const fillSite = async () => {
  const maxUsers = await testPrisma.user.count({ where: { disabled: false } });
  await testPrisma.siteSettings.upsert({
    where: { id: 1 },
    create: { ...DEFAULTS, maxUsers },
    update: { maxUsers }
  });
};

/** Put the site into one registration mode. */
const setRegistration = async (
  registrationStatus: 'open' | 'invite' | 'closed'
) => {
  await testPrisma.siteSettings.upsert({
    where: { id: 1 },
    create: { ...DEFAULTS, registrationStatus },
    update: { registrationStatus }
  });
};

const balance = async (id: number) =>
  (await testPrisma.user.findUniqueOrThrow({ where: { id } })).inviteCount;

describe('createInvite send gates', () => {
  it('refuses a member whose downloads are disabled, spending nothing and writing no invite', async () => {
    const member = await mkUser({ canDownload: false });

    expect(await createInvite(member.id, 'a@example.com', '')).toEqual({
      ok: false,
      reason: 'downloads_disabled'
    });
    expect(await balance(member.id)).toBe(1);
    expect(await testPrisma.invite.count()).toBe(0);
  });

  it('refuses a member with two active warnings, and not once they expire', async () => {
    const poor = await mkUser();
    await warn(poor.id, DAY_MS, 2);
    const lapsed = await mkUser();
    await warn(lapsed.id, -DAY_MS, 2);

    expect(await createInvite(poor.id, 'a@example.com', '')).toEqual({
      ok: false,
      reason: 'poor_standing'
    });
    expect(await balance(poor.id)).toBe(1);
    expect(await createInvite(lapsed.id, 'b@example.com', '')).toMatchObject({
      ok: true
    });
  });

  it('refuses a member on watch whose ratio is still short', async () => {
    const member = await mkUser({ consumed: 20n * GiB });
    await watch(member.id);

    expect(await createInvite(member.id, 'a@example.com', '')).toEqual({
      ok: false,
      reason: 'ratio_watch'
    });
    expect(await balance(member.id)).toBe(1);
  });

  it('sends for a member whose row still says WATCH but whose ratio has recovered', async () => {
    const member = await mkUser({
      consumed: 20n * GiB,
      contributed: 40n * GiB
    });
    await watch(member.id);

    expect(await createInvite(member.id, 'a@example.com', '')).toMatchObject({
      ok: true
    });
  });

  it('sends for a member short of ratio who is not on watch', async () => {
    const member = await mkUser({ consumed: 20n * GiB });

    expect(await createInvite(member.id, 'a@example.com', '')).toMatchObject({
      ok: true
    });
  });

  it('names the revoke, not the full site, when both apply', async () => {
    const member = await mkUser({ canInvite: false });
    await fillSite();

    expect(await createInvite(member.id, 'a@example.com', '')).toEqual({
      ok: false,
      reason: 'invites_revoked'
    });
  });

  // #673. A closed site refuses registration before it looks at the key at
  // all, so an invite sent now cannot be redeemed by anyone.
  it('refuses a closed site, spending nothing and writing no invite', async () => {
    const member = await mkUser();
    await setRegistration('closed');

    expect(await createInvite(member.id, 'a@example.com', '')).toEqual({
      ok: false,
      reason: 'registration_closed'
    });
    expect(await balance(member.id)).toBe(1);
    expect(await testPrisma.invite.count()).toBe(0);
  });

  // Different facts, different remedies: a seat frees on its own, a closure
  // waits on an operator. Naming the full one sends the member away to wait
  // for something that will not help.
  it('names the closure over the capacity when a closed site is also full', async () => {
    const member = await mkUser();
    await fillSite();
    await setRegistration('closed');

    expect(await createInvite(member.id, 'a@example.com', '')).toEqual({
      ok: false,
      reason: 'registration_closed'
    });
  });

  // The gate is `closed` alone. An invite-only site is the one that needs
  // invites most, so a later `!== 'open'` would break exactly the sites the
  // feature exists for.
  it.each(['open', 'invite'] as const)(
    'lets a member of a %s site send',
    async (mode) => {
      const member = await mkUser();
      await setRegistration(mode);

      expect(
        await createInvite(member.id, `${mode}@example.com`, '')
      ).toMatchObject({ ok: true });
      expect(await balance(member.id)).toBe(0);
    }
  );

  it('refuses a full site before a balance, and spends nothing', async () => {
    const member = await mkUser({ inviteCount: 0 });
    await fillSite();

    expect(await createInvite(member.id, 'a@example.com', '')).toEqual({
      ok: false,
      reason: 'site_full'
    });
  });

  it('tells a gated member why before telling them the address is taken', async () => {
    const other = await mkUser();
    expect(await createInvite(other.id, 'taken@example.com', '')).toMatchObject(
      { ok: true }
    );
    const member = await mkUser({ canDownload: false });

    expect(await createInvite(member.id, 'taken@example.com', '')).toEqual({
      ok: false,
      reason: 'downloads_disabled'
    });
  });

  it('lets an own lapsed invite refill an empty balance, but past no other gate', async () => {
    // The refund inside the write pays for re-inviting your own lapsed invite
    // (ADR-0041), so an empty balance is not a refusal there. Watch still is.
    const lapsed = (inviterId: number, email: string) =>
      testPrisma.invite.create({
        data: {
          inviterId,
          email,
          inviteKey: `key-${email}`,
          expires: new Date(Date.now() - 1000)
        }
      });
    const member = await mkUser({ inviteCount: 0 });
    await lapsed(member.id, 'mine@example.com');
    const watched = await mkUser({ inviteCount: 0, consumed: 20n * GiB });
    await lapsed(watched.id, 'theirs@example.com');
    await watch(watched.id);

    expect(await createInvite(member.id, 'mine@example.com', '')).toMatchObject(
      { ok: true }
    );
    expect(await createInvite(watched.id, 'theirs@example.com', '')).toEqual({
      ok: false,
      reason: 'ratio_watch'
    });
    expect(await balance(watched.id)).toBe(0);
  });

  it('holds canDownload in the spend claim itself, not only in the pre-check', async () => {
    // The pre-check reads before the transaction; this predicate is what still
    // refuses when a staff override lands mid-send.
    const disabled = await mkUser({ canDownload: false });
    const open = await mkUser();

    const claim = (id: number) =>
      testPrisma.user.updateMany({
        where: { id, ...inviteSpendWhere(false) },
        data: { inviteCount: { decrement: 1 } }
      });

    expect((await claim(disabled.id)).count).toBe(0);
    expect((await claim(open.id)).count).toBe(1);
  });
});
