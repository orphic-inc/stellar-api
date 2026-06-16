import {
  request,
  app,
  prismaMock,
  resetApiTestState,
  setCurrentUserPermissions
} from './test/apiTestHarness';

// The authed harness user is id 7. An empty recursive walk keeps these tests
// focused on the route's permission gate; tree assembly is covered by
// inviteTree.spec.ts + the integration suite.
describe('GET /api/users/:id/invite-tree', () => {
  beforeEach(() => {
    resetApiTestState();
    prismaMock.$queryRaw.mockResolvedValue([] as never);
  });

  it('lets a member view their own invite tree', async () => {
    const res = await request(app).get('/api/users/7/invite-tree');
    expect(res.status).toBe(200);
    expect(res.body.tree).toEqual([]);
    expect(res.body.summary.entries).toBe(0);
    expect(res.body.summary.total).toEqual({
      contributed: '0',
      consumed: '0',
      ratio: '1.00'
    });
  });

  it("forbids viewing another member's tree without invites-manage", async () => {
    setCurrentUserPermissions({});
    const res = await request(app).get('/api/users/99/invite-tree');
    expect(res.status).toBe(403);
  });

  it("allows staff with invites-manage to view another member's tree", async () => {
    setCurrentUserPermissions({ invites_manage: true });
    const res = await request(app).get('/api/users/99/invite-tree');
    expect(res.status).toBe(200);
    expect(res.body.summary.branches).toBe(0);
  });
});
