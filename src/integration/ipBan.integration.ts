import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { normalizeIp } from '../lib/ipAddress';
import { isIpBanned, invalidateIpBanCache } from '../modules/ipBan';

/**
 * The proof the ban list is actually read (#540).
 *
 * A unit test with a mocked Prisma passes against the broken code — it asserts
 * the range comparison works, which was never the problem. The problem was that
 * no code path ran a query at all. This drives the real table.
 *
 * It also pins the schema repair: a range crossing 127.255.255.255 could not be
 * stored satisfiably in the old signed-Int columns, and an IPv6 bound could not
 * be stored at all.
 */
beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
  invalidateIpBanCache();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const ban = (from: string, to?: string) =>
  testPrisma.ipBan.create({
    data: { fromIp: normalizeIp(from)!, toIp: normalizeIp(to ?? from)! }
  });

describe('ip ban enforcement', () => {
  it('blocks an address inside a stored range', async () => {
    await ban('10.0.0.1', '10.0.0.255');
    invalidateIpBanCache();

    expect(await isIpBanned('10.0.0.5')).toBe(true);
    expect(await isIpBanned('10.0.1.5')).toBe(false);
  });

  it('blocks a range crossing the old signed-int boundary', async () => {
    // 100.0.0.0-200.0.0.0 stored as from=1677721600, to=-939524096 before this
    // change: accepted by the validator, unsatisfiable by any range predicate.
    await ban('100.0.0.0', '200.0.0.0');
    invalidateIpBanCache();

    expect(await isIpBanned('150.0.0.1')).toBe(true);
    expect(await isIpBanned('99.255.255.255')).toBe(false);
    expect(await isIpBanned('200.0.0.1')).toBe(false);
  });

  it('blocks IPv6, which the previous columns could not represent', async () => {
    await ban('2001:db8::1', '2001:db8::ff');
    invalidateIpBanCache();

    expect(await isIpBanned('2001:db8::5')).toBe(true);
    expect(await isIpBanned('2001:db9::5')).toBe(false);
  });

  it('blocks the IPv4-mapped form req.ip yields on a dual-stack socket', async () => {
    await ban('8.8.8.8');
    invalidateIpBanCache();

    expect(await isIpBanned('::ffff:8.8.8.8')).toBe(true);
  });

  it('leaves an unbanned address alone', async () => {
    await ban('10.0.0.1', '10.0.0.255');
    invalidateIpBanCache();

    expect(await isIpBanned('203.0.113.9')).toBe(false);
  });

  it('stores bounds as 32 hex characters', async () => {
    await ban('8.8.8.8');
    const row = await testPrisma.ipBan.findFirst();
    expect(row?.fromIp).toBe('00000000000000000000ffff08080808');
    expect(row?.fromIp).toHaveLength(32);
  });
});
