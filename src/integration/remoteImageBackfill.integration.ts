/**
 * The remote image backfill against a real DB (#738). What only means
 * something together: the walk across real tables, each URL owned by its
 * earliest author, a real import, the report, and a re-run that queues
 * nothing, imports nothing twice and changes no owner.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { seedSystemUser } from '../modules/bootstrap';
import { runBackfill } from '../modules/remoteImageBackfill';
import type { UrlGuardResult } from '../lib/ssrfGuard';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('remote-image-backfill')
]);

let server: http.Server;
let port: number;

// The production guard refuses loopback; vet the test host to the local server.
const check = async (raw: string): Promise<UrlGuardResult> => ({
  ok: true,
  url: new URL(raw),
  addresses: [{ address: '127.0.0.1', family: 4 }]
});

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/text.png') return void res.end('not an image at all');
    res.end(PNG);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await testPrisma.$disconnect();
});

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

const urlFor = (path: string) => `http://images.example:${port}${path}`;

const makeUser = async (username: string, avatar = '') => {
  const rank = await testPrisma.userRank.findFirstOrThrow();
  return testPrisma.user.create({
    data: {
      username,
      email: `${username}@test.local`,
      password: 'x',
      avatar,
      userRankId: rank.id,
      userSettingsId: (await testPrisma.userSettings.create({ data: {} })).id,
      profileId: (await testPrisma.profile.create({ data: {} })).id
    }
  });
};

const makeTopic = async (authorId: number) => {
  const category = await testPrisma.forumCategory.create({
    data: { name: 'General', sort: 0 }
  });
  const forum = await testPrisma.forum.create({
    data: { forumCategoryId: category.id, sort: 0, name: 'Forum' }
  });
  return testPrisma.forumTopic.create({
    data: { title: 'T', forumId: forum.id, authorId }
  });
};

const run = (systemId: number) =>
  runBackfill(testPrisma, systemId, {
    // Well inside the test timeout, so a stuck import fails an assertion
    // rather than timing the test out.
    deadline: Date.now() + 15_000,
    process: { fetchOptions: { check } }
  });

const ownerOf = async (url: string) =>
  (await testPrisma.remoteImage.findUniqueOrThrow({ where: { url } }))
    .requestedById;

/**
 * Three remote images: one in two forum posts by different authors, one in
 * news (no author), and one avatar whose host serves no image.
 */
const seedContent = async () => {
  const systemId = await seedSystemUser(testPrisma);
  const first = await makeUser('first');
  const second = await makeUser('second', urlFor('/text.png'));
  const shared = urlFor('/shared.png');
  const news = urlFor('/news.png');

  const topic = await makeTopic(first.id);
  // The later post is written first, so the order found is not the answer.
  for (const [authorId, day] of [
    [second.id, '2026-01-02'],
    [first.id, '2026-01-01']
  ] as const) {
    await testPrisma.forumPost.create({
      data: {
        forumTopicId: topic.id,
        authorId,
        body: `[img]${shared}[/img]`,
        createdAt: new Date(day)
      }
    });
  }
  await testPrisma.news.create({
    data: { title: 'N', body: `[img]${news}[/img]` }
  });
  return { systemId, first, second, shared, news };
};

it('imports every stored remote image by its earliest author, and a re-run changes nothing', async () => {
  const { systemId, first, second, shared, news } = await seedContent();

  const report = await run(systemId);

  expect(report).toMatchObject({
    bySurface: {
      'forumPost.body': 1,
      'news.body': 1,
      'user.avatar': 1
    },
    total: 3,
    queued: 3,
    imported: 2,
    pending: 0,
    failed: [
      {
        url: urlFor('/text.png'),
        host: `images.example:${port}`,
        reason: expect.stringMatching(/Unsupported asset type/)
      }
    ]
  });
  expect(await ownerOf(shared)).toBe(first.id);
  expect(await ownerOf(news)).toBe(systemId);
  expect(await ownerOf(urlFor('/text.png'))).toBe(second.id);

  const rows = await testPrisma.remoteImage.findMany({
    orderBy: { id: 'asc' }
  });
  const again = await run(systemId);

  expect(again).toMatchObject({ queued: 0, imported: 2, pending: 0 });
  expect(again.failed).toHaveLength(1);
  // Same rows, same owners, same attempts: nothing queued, retried or re-owned.
  expect(
    await testPrisma.remoteImage.findMany({ orderBy: { id: 'asc' } })
  ).toEqual(rows);
  expect(await testPrisma.asset.count()).toBe(1);
});
