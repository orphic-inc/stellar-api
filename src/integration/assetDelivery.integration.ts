/**
 * `GET /asset/{hash}` against a real database (#880). #878 shipped because
 * `asset.spec.ts` mocks Prisma: its stub returned `Asset.data` as a `Buffer`,
 * while Prisma 6 returns a `Bytes` column as a `Uint8Array`, which `res.send`
 * serialises as a JSON object of byte values. Here the bytes go in through the
 * real store and come back out through the app, so a mock that drifts from
 * Prisma again cannot hide the same defect.
 */
import request from 'supertest';
import type { Response } from 'superagent';
import jwt from 'jsonwebtoken';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { putAsset, uploadAsset } from '../modules/assetStore';
import { auth as authConfig } from '../modules/config';
import app from '../app';

// A PNG signature, then bytes chosen to break any text or JSON round-trip:
// a NUL, a lone high byte and every byte from 0x80 to 0xff.
const png = (tag: string): Buffer =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(tag),
    Buffer.from([0x00, 0xff]),
    Buffer.from(Array.from({ length: 128 }, (_, i) => 0x80 + i))
  ]);

// Collect the raw body whatever its Content-Type, so the comparison sees the
// bytes on the wire rather than superagent's reading of them.
const rawBody = (
  res: Response,
  done: (err: Error | null, body: Buffer) => void
): void => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

let memberId: number;

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
  // The install barrier answers 503 to every route until this is stamped.
  await testPrisma.siteSettings.create({
    data: { id: 1, dismissedLaunchChecklist: [], installedAt: new Date() }
  });
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  const member = await testPrisma.user.create({
    data: {
      username: 'member',
      email: 'member@test.local',
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
  memberId = member.id;
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe('GET /api/asset/:hash', () => {
  it('sends a site-owned asset byte for byte, with no session', async () => {
    const bytes = png('site');
    const asset = await putAsset(
      { data: bytes, kind: 'ThemeImage' },
      testPrisma
    );

    const res = await request(app)
      .get(`/api/asset/${asset.hash}`)
      .buffer(true)
      .parse(rawBody);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(bytes.length);
    expect(Buffer.compare(res.body, bytes)).toBe(0);
    expect(res.headers['content-type']).toBe('image/png');
  });

  it('sends a member asset byte for byte to a session, and refuses one without', async () => {
    const bytes = png('member');
    const asset = await uploadAsset(
      { data: bytes, kind: 'Avatar', ownerId: memberId, assetLimit: null },
      testPrisma
    );
    const token = jwt.sign({ user: { id: memberId } }, authConfig.jwtSecret, {
      expiresIn: 60
    });

    const res = await request(app)
      .get(`/api/asset/${asset.hash}`)
      .set('Cookie', `token=${token}`)
      .buffer(true)
      .parse(rawBody);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(bytes.length);
    expect(Buffer.compare(res.body, bytes)).toBe(0);
    expect(res.headers['content-type']).toBe('image/png');

    const anonymous = await request(app).get(`/api/asset/${asset.hash}`);
    expect(anonymous.status).toBe(401);
  });
});
