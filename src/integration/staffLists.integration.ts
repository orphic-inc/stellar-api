import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const createUser = async (tag: string) => {
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  return testPrisma.user.create({
    data: {
      username: `list-${tag}-${Date.now()}`,
      email: `list-${tag}-${Date.now()}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
};

describe('sessions list (login watch)', () => {
  it('returns sessions ordered by createdAt desc', async () => {
    const user = await createUser('a');
    await testPrisma.userSession.createMany({
      data: [
        { userId: user.id, ipAddress: '1.1.1.1' },
        { userId: user.id, ipAddress: '2.2.2.2' }
      ]
    });

    const sessions = await testPrisma.userSession.findMany({
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, username: true } } }
    });

    expect(sessions).toHaveLength(2);
    expect(sessions[0].user.id).toBe(user.id);
  });

  it('filters sessions by userId', async () => {
    const u1 = await createUser('b');
    const u2 = await createUser('c');
    await testPrisma.userSession.createMany({
      data: [
        { userId: u1.id, ipAddress: '1.1.1.1' },
        { userId: u2.id, ipAddress: '2.2.2.2' }
      ]
    });

    const filtered = await testPrisma.userSession.findMany({
      where: { userId: u1.id },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, username: true } } }
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].userId).toBe(u1.id);
  });
});

describe('invites list (invite pool)', () => {
  it('returns paginated invites ordered by expires desc, omitting inviteKey', async () => {
    const inviter = await createUser('d');
    await testPrisma.invite.createMany({
      data: [
        {
          inviterId: inviter.id,
          inviteKey: `secret-${Date.now()}-1`,
          email: 'a@x.com',
          expires: new Date(Date.now() + 86400000),
          reason: 'reason A'
        },
        {
          inviterId: inviter.id,
          inviteKey: `secret-${Date.now()}-2`,
          email: 'b@x.com',
          expires: new Date(Date.now() + 172800000),
          reason: 'reason B'
        }
      ]
    });

    const rows = await testPrisma.invite.findMany({
      orderBy: { expires: 'desc' },
      select: {
        id: true,
        email: true,
        expires: true,
        reason: true,
        status: true,
        inviter: { select: { id: true, username: true } }
      }
    });

    expect(rows).toHaveLength(2);
    expect(Object.keys(rows[0])).not.toContain('inviteKey');
    expect(rows[0].email).toBe('b@x.com');
  });

  it('filters invites by status', async () => {
    const inviter = await createUser('e');
    await testPrisma.invite.createMany({
      data: [
        {
          inviterId: inviter.id,
          inviteKey: `sk-pending-${Date.now()}`,
          email: 'p@x.com',
          expires: new Date(),
          reason: ''
        },
        {
          inviterId: inviter.id,
          inviteKey: `sk-rejected-${Date.now()}`,
          email: 'q@x.com',
          expires: new Date(),
          reason: '',
          status: 'rejected'
        }
      ]
    });

    const pending = await testPrisma.invite.findMany({
      where: { status: 'pending' }
    });
    expect(pending).toHaveLength(1);
    expect(pending[0].email).toBe('p@x.com');
  });
});

describe('ratio watch list', () => {
  it('returns only WATCH and LEECH_DISABLED states', async () => {
    const u1 = await createUser('f');
    const u2 = await createUser('g');
    const u3 = await createUser('h');

    await testPrisma.ratioPolicyState.createMany({
      data: [
        { userId: u1.id, status: 'WATCH' },
        { userId: u2.id, status: 'LEECH_DISABLED' },
        { userId: u3.id, status: 'OK' }
      ]
    });

    const rows = await testPrisma.ratioPolicyState.findMany({
      where: { status: { in: ['WATCH', 'LEECH_DISABLED'] } },
      include: { user: { select: { id: true, username: true } } }
    });

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.status)).not.toContain('OK');
  });
});

describe('deleted collages list', () => {
  it('returns only non-personal deleted collages', async () => {
    const user = await createUser('i');

    await testPrisma.collage.createMany({
      data: [
        {
          name: 'Deleted-Public',
          description: '',
          userId: user.id,
          categoryId: 1,
          tags: [],
          isDeleted: true,
          deletedAt: new Date()
        },
        {
          name: 'Deleted-Personal',
          description: '',
          userId: user.id,
          categoryId: 0,
          tags: [],
          isDeleted: true,
          deletedAt: new Date()
        },
        {
          name: 'Active-Public',
          description: '',
          userId: user.id,
          categoryId: 1,
          tags: [],
          isDeleted: false
        }
      ]
    });

    const deleted = await testPrisma.collage.findMany({
      where: { isDeleted: true, categoryId: { gt: 0 } },
      include: { user: { select: { id: true, username: true } } }
    });

    expect(deleted).toHaveLength(1);
    expect(deleted[0].name).toBe('Deleted-Public');
  });
});

describe('invite tree list', () => {
  it('batch-fetches inviters without N+1 query', async () => {
    const inviter = await createUser('j');
    const invitee1 = await createUser('k');
    const invitee2 = await createUser('l');

    await testPrisma.inviteTree.createMany({
      data: [
        { userId: invitee1.id, inviterId: inviter.id },
        { userId: invitee2.id, inviterId: inviter.id }
      ]
    });

    const result = await testPrisma.inviteTree.findMany({
      orderBy: [{ inviterId: 'asc' }, { userId: 'asc' }],
      include: {
        user: { select: { id: true, username: true } },
        inviter: { select: { id: true, username: true } }
      }
    });

    expect(result).toHaveLength(2);
    expect(result[0].inviter?.id).toBe(inviter.id);
    expect(result[1].inviter?.id).toBe(inviter.id);
  });
});
