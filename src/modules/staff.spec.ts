const mockStaffGroupFindMany = jest.fn();
const mockUserFindMany = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    staffGroup: { findMany: mockStaffGroupFindMany },
    user: { findMany: mockUserFindMany }
  }
}));

// staff → bbcodeRender → bbcode/sanitizeConfig eagerly loads isomorphic-dompurify
// (jsdom ESM), which jest can't parse. Stub the sanitizer; render output is
// covered by bbcode.spec.ts.
jest.mock('../lib/bbcode/sanitizeConfig', () => ({
  sanitizeBBCode: (v: string) => v
}));

import { getStaffList } from './staff';

const makeGroup = (id: number, name: string, sortOrder: number) => ({
  id,
  name,
  sortOrder
});

const makeStaffUser = (
  id: number,
  username: string,
  staffGroupId: number | null,
  level = 100,
  overrides: Record<string, unknown> = {}
) => ({
  id,
  username,
  lastLogin: new Date('2026-01-01T12:00:00.000Z'),
  staffBio: null,
  userRank: { name: 'Moderator', color: '#ff0000', level, staffGroupId },
  ...overrides
});

beforeEach(() => {
  mockStaffGroupFindMany.mockReset();
  mockUserFindMany.mockReset();
});

describe('getStaffList', () => {
  it('returns empty groups array when no groups or displayStaff users exist', async () => {
    mockStaffGroupFindMany.mockResolvedValue([]);
    mockUserFindMany.mockResolvedValue([]);

    const result = await getStaffList();
    expect(result).toEqual({ groups: [] });
  });

  it('returns groups with no members when groups exist but no staff users', async () => {
    mockStaffGroupFindMany.mockResolvedValue([makeGroup(1, 'Mods', 1)]);
    mockUserFindMany.mockResolvedValue([]);

    const result = await getStaffList();
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({
      id: 1,
      name: 'Mods',
      members: []
    });
  });

  it('nests members under the correct group', async () => {
    mockStaffGroupFindMany.mockResolvedValue([makeGroup(1, 'Mods', 1)]);
    mockUserFindMany.mockResolvedValue([makeStaffUser(10, 'alice', 1)]);

    const result = await getStaffList();
    expect(result.groups[0].members).toHaveLength(1);
    expect(result.groups[0].members[0].username).toBe('alice');
  });

  it('maps member fields correctly', async () => {
    mockStaffGroupFindMany.mockResolvedValue([makeGroup(1, 'Mods', 1)]);
    mockUserFindMany.mockResolvedValue([
      makeStaffUser(10, 'alice', 1, 100, { staffBio: 'Forum moderator' })
    ]);

    const result = await getStaffList();
    const member = result.groups[0].members[0];
    expect(member).toMatchObject({
      userId: 10,
      username: 'alice',
      rankName: 'Moderator',
      rankColor: '#ff0000',
      lastSeen: '2026-01-01T12:00:00.000Z',
      staffBio: 'Forum moderator'
    });
  });

  it('places users with staffGroupId null in Ungrouped bucket', async () => {
    mockStaffGroupFindMany.mockResolvedValue([makeGroup(1, 'Mods', 1)]);
    mockUserFindMany.mockResolvedValue([makeStaffUser(20, 'bob', null)]);

    const result = await getStaffList();
    expect(result.groups).toHaveLength(2);
    const ungrouped = result.groups.find((g) => g.id === null);
    expect(ungrouped?.name).toBe('Ungrouped');
    expect(ungrouped?.members[0].username).toBe('bob');
  });

  it('omits Ungrouped bucket when no ungrouped staff', async () => {
    mockStaffGroupFindMany.mockResolvedValue([makeGroup(1, 'Mods', 1)]);
    mockUserFindMany.mockResolvedValue([makeStaffUser(10, 'alice', 1)]);

    const result = await getStaffList();
    expect(result.groups.every((g) => g.id !== null)).toBe(true);
  });

  it('sets lastSeen to null when lastLogin is null', async () => {
    mockStaffGroupFindMany.mockResolvedValue([makeGroup(1, 'Mods', 1)]);
    mockUserFindMany.mockResolvedValue([
      makeStaffUser(10, 'alice', 1, 100, { lastLogin: null })
    ]);

    const result = await getStaffList();
    expect(result.groups[0].members[0].lastSeen).toBeNull();
  });
});
