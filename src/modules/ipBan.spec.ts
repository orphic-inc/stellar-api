import { normalizeIp } from '../lib/ipAddress';
import { prisma } from '../lib/prisma';
// One module instance throughout. An earlier draft used `jest.resetModules()`
// plus `require`, which handed the re-required module a DIFFERENT prisma mock
// than the one asserted on here; cache state is reset with the exported
// invalidator instead, which needs no module juggling.
import { isIpBanned, invalidateIpBanCache } from './ipBan';

jest.mock('../lib/prisma', () => ({
  prisma: { ipBan: { findMany: jest.fn() } }
}));

const ban = (from: string, to?: string) => ({
  fromIp: normalizeIp(from)!,
  toIp: normalizeIp(to ?? from)!
});

describe('isIpBanned', () => {
  beforeEach(() => {
    (prisma.ipBan.findMany as jest.Mock).mockReset();
    invalidateIpBanCache();
  });

  it('matches an address inside a banned range', async () => {
    (prisma.ipBan.findMany as jest.Mock).mockResolvedValue([
      ban('10.0.0.1', '10.0.0.255')
    ]);
    expect(await isIpBanned('10.0.0.5')).toBe(true);
    expect(await isIpBanned('10.0.1.5')).toBe(false);
  });

  it('matches a range crossing the old signed-int boundary', async () => {
    // Unrepresentable before: stored from=1677721600, to=-939524096, which no
    // SQL range predicate could satisfy — so the ban matched nothing.
    (prisma.ipBan.findMany as jest.Mock).mockResolvedValue([
      ban('100.0.0.0', '200.0.0.0')
    ]);
    expect(await isIpBanned('150.0.0.1')).toBe(true);
  });

  it('matches an IPv4-mapped address, the form req.ip can yield', async () => {
    (prisma.ipBan.findMany as jest.Mock).mockResolvedValue([ban('8.8.8.8')]);
    expect(await isIpBanned('::ffff:8.8.8.8')).toBe(true);
  });

  it('matches IPv6, which the previous schema could not express', async () => {
    (prisma.ipBan.findMany as jest.Mock).mockResolvedValue([
      ban('2001:db8::1', '2001:db8::ff')
    ]);
    expect(await isIpBanned('2001:db8::5')).toBe(true);
    expect(await isIpBanned('2001:db9::5')).toBe(false);
  });

  it('does not put an IPv6 client inside an all-IPv4 ban', async () => {
    (prisma.ipBan.findMany as jest.Mock).mockResolvedValue([
      ban('0.0.0.0', '255.255.255.255')
    ]);
    expect(await isIpBanned('2001:db8::1')).toBe(false);
  });

  it('fails open on an unparseable or absent address', async () => {
    (prisma.ipBan.findMany as jest.Mock).mockResolvedValue([
      ban('0.0.0.0', '255.255.255.255')
    ]);
    expect(await isIpBanned(undefined)).toBe(false);
    expect(await isIpBanned('not-an-ip')).toBe(false);
  });

  it('caches the list, and invalidation forces a reload', async () => {
    (prisma.ipBan.findMany as jest.Mock).mockResolvedValue([ban('10.0.0.1')]);

    await isIpBanned('10.0.0.1');
    await isIpBanned('10.0.0.2');
    expect(prisma.ipBan.findMany as jest.Mock).toHaveBeenCalledTimes(1);

    invalidateIpBanCache();
    await isIpBanned('10.0.0.1');
    expect(prisma.ipBan.findMany as jest.Mock).toHaveBeenCalledTimes(2);
  });
});
