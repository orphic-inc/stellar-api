import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank
} from './test/apiTestHarness';
import { getStaffList } from './modules/staff';

const mockGetStaffList = getStaffList as jest.MockedFunction<
  typeof getStaffList
>;

const makeStaffResponse = () => ({
  groups: [
    {
      id: 1,
      name: 'Moderators',
      sortOrder: 1,
      members: [
        {
          userId: 10,
          username: 'alice',
          rankName: 'Moderator',
          rankColor: '#dc2626',
          lastSeen: '2026-01-01T00:00:00.000Z',
          staffBio: null
        }
      ]
    }
  ]
});

beforeEach(() => {
  resetApiTestState();
  // Auth is always mocked; route needs login only — any authenticated user can view staff
  prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank() as never);
});

describe('GET /api/staff', () => {
  it('returns groups array for authenticated users', async () => {
    mockGetStaffList.mockResolvedValue(makeStaffResponse());

    const res = await request(app).get('/api/staff');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('groups');
    expect(Array.isArray(res.body.groups)).toBe(true);
    expect(res.body.groups[0].name).toBe('Moderators');
    expect(res.body.groups[0].members[0].username).toBe('alice');
  });

  it('returns empty groups when no staff are configured', async () => {
    mockGetStaffList.mockResolvedValue({ groups: [] });

    const res = await request(app).get('/api/staff');

    expect(res.status).toBe(200);
    expect(res.body.groups).toEqual([]);
  });
});
