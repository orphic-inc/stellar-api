import { prisma } from '../lib/prisma';
import type { PageParams } from '../lib/pagination';

// The staff registration log (#850, grilled on #638). The inviter carries the
// invitee's own projection, so the two halves of a row compare field for field.
const ENTRY_SELECT = {
  id: true,
  username: true,
  email: true,
  dateRegistered: true,
  disabled: true,
  lastIp: true,
  userRank: { select: { id: true, name: true } }
} as const;

type IpCounts = Map<string, number>;

// Every IP here is the account's CURRENT one; Stellar keeps no IP at
// registration. `null` when the account has no IP on record.
const withIpAccounts = <T extends { lastIp: string | null }>(
  entry: T,
  counts: IpCounts
) => ({
  ...entry,
  lastIpAccounts: entry.lastIp === null ? null : (counts.get(entry.lastIp) ?? 0)
});

// How many accounts hold each IP, in one grouped read over the page's IPs.
const countIpAccounts = async (ips: string[]): Promise<IpCounts> => {
  if (ips.length === 0) return new Map();
  const groups = await prisma.user.groupBy({
    by: ['lastIp'],
    where: { lastIp: { in: ips } },
    _count: { lastIp: true }
  });
  return new Map(groups.map((g) => [g.lastIp!, g._count.lastIp]));
};

export const getRegistrationLog = async (pg: PageParams) => {
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      orderBy: { dateRegistered: 'desc' },
      skip: pg.skip,
      take: pg.limit,
      select: {
        ...ENTRY_SELECT,
        inviteTree: { select: { inviter: { select: ENTRY_SELECT } } }
      }
    }),
    prisma.user.count()
  ]);

  const inviters = users.map((u) => u.inviteTree?.inviter ?? null);
  const ips = [...users, ...inviters].flatMap((e) =>
    e?.lastIp ? [e.lastIp] : []
  );
  const counts = await countIpAccounts([...new Set(ips)]);

  const rows = users.map(({ inviteTree: _edge, ...user }, i) => {
    const inviter = inviters[i];
    return {
      ...withIpAccounts(user, counts),
      inviter: inviter ? withIpAccounts(inviter, counts) : null,
      sameIp: user.lastIp !== null && user.lastIp === inviter?.lastIp
    };
  });

  return { rows, total };
};
