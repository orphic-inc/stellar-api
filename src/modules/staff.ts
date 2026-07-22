import { prisma } from '../lib/prisma';
import { renderSiteBBCode } from './bbcodeRender';

export async function getStaffList() {
  const [groups, staffUsers] = await Promise.all([
    prisma.staffGroup.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
    }),
    // lastLogin is exposed to all authenticated users for staff members — deliberate
    // privacy exception; staff accept reduced visibility on last-seen as part of the role.
    prisma.user.findMany({
      where: { disabled: false, userRank: { displayStaff: true } },
      select: {
        id: true,
        username: true,
        lastLogin: true,
        staffBio: true,
        userRank: {
          select: { name: true, color: true, level: true, staffGroupId: true }
        }
      },
      orderBy: [{ userRank: { level: 'desc' } }, { username: 'asc' }]
    })
  ]);

  const byGroup = new Map<number | null, typeof staffUsers>();
  for (const u of staffUsers) {
    const key = u.userRank.staffGroupId ?? null;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(u);
  }

  // Additive render-at-read: raw `staffBio` is unchanged; `staffBioHtml` is the
  // server-rendered BBCode transcription the staff roster consumes (#402).
  const toMember = async (u: (typeof staffUsers)[number]) => ({
    userId: u.id,
    username: u.username,
    rankName: u.userRank.name,
    rankColor: u.userRank.color,
    lastSeen: u.lastLogin?.toISOString() ?? null,
    staffBio: u.staffBio ?? null,
    staffBioHtml: await renderSiteBBCode(u.staffBio)
  });

  type StaffGroupRow = {
    id: number | null;
    name: string;
    sortOrder: number;
    members: Awaited<ReturnType<typeof toMember>>[];
  };

  const result: StaffGroupRow[] = await Promise.all(
    groups.map(async (g) => ({
      id: g.id,
      name: g.name,
      sortOrder: g.sortOrder,
      members: await Promise.all((byGroup.get(g.id) ?? []).map(toMember))
    }))
  );

  const ungrouped = byGroup.get(null) ?? [];
  if (ungrouped.length > 0) {
    result.push({
      id: null,
      name: 'Ungrouped',
      sortOrder: 9999,
      members: await Promise.all(ungrouped.map(toMember))
    });
  }

  return { groups: result };
}
