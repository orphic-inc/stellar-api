/**
 * Remote image import against a real DB (#737, ADR-0051). The unit specs mock
 * Prisma and the fetch; this proves what only means something together: the
 * migration's table and enum, a real fetch into a real `Imported` asset, the
 * quota exemption as an actual count, the ceiling as an actual count, the URL's
 * uniqueness under a race, and the sweep keeping, then collecting, an import —
 * with the row going with its asset.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import {
  importedAssetUrls,
  processDueRemoteImages,
  registerRemoteImages
} from '../modules/remoteImage';
import { getOwnedAssetCount } from '../modules/assetStore';
import { sweepOrphanedAssets, GRACE_MS } from '../modules/assetSweep';
import { imageImport } from '../modules/config';
import { createPost, createTopic } from '../modules/forum';
import { renderSiteBBCode } from '../modules/bbcodeRender';
import type { UrlGuardResult } from '../lib/ssrfGuard';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('remote-image-integration')
]);

let server: http.Server;
let port: number;
let userId: number;

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
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  const user = await testPrisma.user.create({
    data: {
      username: 'poster',
      email: 'poster@test.local',
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
  userId = user.id;
});

const urlFor = (path: string) => `http://images.example:${port}${path}`;

const runJob = () =>
  processDueRemoteImages(testPrisma, { fetchOptions: { check } });

describe('import', () => {
  it('fetches a registered URL into an Imported asset the requester owns', async () => {
    const url = urlFor('/a.png');
    expect(await registerRemoteImages([url], userId, {}, testPrisma)).toBe(1);

    expect(await runJob()).toEqual({ imported: 1, retry: 0, failed: 0 });

    const row = await testPrisma.remoteImage.findUniqueOrThrow({
      where: { url }
    });
    expect(row).toMatchObject({
      status: 'imported',
      attempts: 1,
      reason: null
    });
    const asset = await testPrisma.asset.findUniqueOrThrow({
      where: { hash: row.assetHash! }
    });
    expect(asset).toMatchObject({
      kind: 'Imported',
      ownerId: userId,
      mime: 'image/png'
    });
    expect((await importedAssetUrls([url], testPrisma)).get(url)).toBe(
      `/api/asset/${asset.hash}`
    );
    // An import is not an upload: the rank assetLimit does not see it.
    expect(await getOwnedAssetCount(userId, testPrisma)).toBe(0);
  });

  it('records why a body that is not an image failed, and stores nothing', async () => {
    const url = urlFor('/text.png');
    await registerRemoteImages([url], userId, {}, testPrisma);

    expect(await runJob()).toEqual({ imported: 0, retry: 0, failed: 1 });

    const row = await testPrisma.remoteImage.findUniqueOrThrow({
      where: { url }
    });
    expect(row.status).toBe('failed');
    expect(row.reason).toMatch(/Unsupported asset type/);
    expect(await testPrisma.asset.count()).toBe(0);
  });

  it('keeps one row when two writes register the same new URL at once', async () => {
    const url = urlFor('/race.png');
    await Promise.all([
      registerRemoteImages([url], userId, {}, testPrisma),
      registerRemoteImages([url], userId, {}, testPrisma)
    ]);
    expect(await testPrisma.remoteImage.count({ where: { url } })).toBe(1);
  });
});

describe('daily ceiling', () => {
  it('refuses the new URL past the ceiling, but not a reused one', async () => {
    await testPrisma.remoteImage.createMany({
      data: Array.from({ length: imageImport.dailyLimit }, (_, i) => ({
        url: urlFor(`/seen-${i}.png`),
        requestedById: userId
      }))
    });

    await expect(
      registerRemoteImages([urlFor('/one-more.png')], userId, {}, testPrisma)
    ).rejects.toMatchObject({ statusCode: 429 });
    await expect(
      registerRemoteImages([urlFor('/seen-0.png')], userId, {}, testPrisma)
    ).resolves.toBe(0);
    await expect(
      registerRemoteImages(
        [urlFor('/one-more.png')],
        userId,
        { exempt: true },
        testPrisma
      )
    ).resolves.toBe(1);
  });
});

describe('sweep', () => {
  it('keeps an import while content references its URL, then collects it and its row', async () => {
    const url = urlFor('/avatar.png');
    await registerRemoteImages([url], userId, {}, testPrisma);
    await runJob();
    const { assetHash } = await testPrisma.remoteImage.findUniqueOrThrow({
      where: { url }
    });
    // Past the grace window, so only the reference protects it.
    await testPrisma.asset.update({
      where: { hash: assetHash! },
      data: { createdAt: new Date(Date.now() - GRACE_MS - 60_000) }
    });

    await testPrisma.user.update({
      where: { id: userId },
      data: { avatar: url }
    });
    expect(await sweepOrphanedAssets(testPrisma)).toBe(0);
    expect(await testPrisma.asset.count()).toBe(1);

    await testPrisma.user.update({
      where: { id: userId },
      data: { avatar: '' }
    });
    expect(await sweepOrphanedAssets(testPrisma)).toBe(1);
    expect(await testPrisma.asset.count()).toBe(0);
    // The row went with its asset, so a later reference imports it afresh.
    expect(await testPrisma.remoteImage.count()).toBe(0);
  });
});

describe('a forum post (#737 slice 2)', () => {
  const viewer = { showMature: false };

  const createForum = async () => {
    const category = await testPrisma.forumCategory.create({
      data: { name: 'General', sort: 0 }
    });
    return testPrisma.forum.create({
      data: { forumCategoryId: category.id, sort: 0, name: 'Forum' }
    });
  };

  it('renders its [img] as a link until imported, then from the asset store', async () => {
    const url = urlFor('/post.png');
    const body = `Look: [img]${url}[/img]`;
    const forum = await createForum();
    const topic = await createTopic(forum.id, userId, { title: 'T', body });
    const post = await testPrisma.forumPost.findFirstOrThrow({
      where: { forumTopicId: topic.id }
    });

    const pending = await renderSiteBBCode(post.body, viewer);
    expect(pending).toContain(`href="${url}"`);
    expect(pending).toContain('(image)');
    expect(pending).not.toContain('<img');

    expect(await runJob()).toEqual({ imported: 1, retry: 0, failed: 0 });
    const { assetHash } = await testPrisma.remoteImage.findUniqueOrThrow({
      where: { url }
    });
    // Rendered again straight away: the pending render was not cached.
    expect(await renderSiteBBCode(post.body, viewer)).toContain(
      `<img src="/api/asset/${assetHash}"`
    );
    // The member's text is never rewritten.
    const stored = await testPrisma.forumPost.findUniqueOrThrow({
      where: { id: post.id }
    });
    expect(stored.body).toBe(body);
  });

  it('refuses a reply past the ceiling whole', async () => {
    const forum = await createForum();
    const topic = await createTopic(forum.id, userId, {
      title: 'T',
      body: 'opener'
    });
    // Another author, so the reply is not merged into the opener.
    const rank = await testPrisma.userRank.findFirstOrThrow();
    const replier = await testPrisma.user.create({
      data: {
        username: 'replier',
        email: 'replier@test.local',
        password: 'x',
        avatar: '',
        userRankId: rank.id,
        userSettingsId: (await testPrisma.userSettings.create({ data: {} })).id,
        profileId: (await testPrisma.profile.create({ data: {} })).id
      }
    });
    await testPrisma.remoteImage.createMany({
      data: Array.from({ length: imageImport.dailyLimit }, (_, i) => ({
        url: urlFor(`/seen-${i}.png`),
        requestedById: replier.id
      }))
    });
    const url = urlFor('/new.png');

    await expect(
      createPost(forum.id, topic.id, replier.id, `[img]${url}[/img]`)
    ).rejects.toMatchObject({ statusCode: 429 });

    expect(
      await testPrisma.forumPost.count({ where: { forumTopicId: topic.id } })
    ).toBe(1);
    expect(await testPrisma.remoteImage.count({ where: { url } })).toBe(0);
  });
});
