import {
  FileType,
  ReleaseType,
  CommunityType,
  RegistrationStatus,
  RatioExempt,
  RatioPolicyStatus
} from '@prisma/client';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { grantDownloadAccess } from '../modules/downloads';
import { getLedgerSnapshot, getNewConsumptionEvents } from '../modules/ledger';
import { korin } from '../modules/config';

// grantDownloadAccess kicks off evaluateRatioPolicy as a post-commit fire-and-forget
// (deliberately un-awaited in production). This suite tests the ledger/gate path, not
// the policy state machine, so stub it — otherwise its queries land after the suite
// tears down ("Cannot log after tests are done" → non-zero exit). Mirrors the unit
// specs, which mock ./ratioPolicy for the same reason.
jest.mock('../modules/ratioPolicy', () => ({
  ...jest.requireActual('../modules/ratioPolicy'),
  evaluateRatioPolicy: jest.fn(() => Promise.resolve())
}));

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const createUser = async (
  tag: string,
  overrides: { contributed?: bigint; consumed?: bigint } = {}
) => {
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  return testPrisma.user.create({
    data: {
      username: `lg-${tag}-${Date.now()}`,
      email: `lg-${tag}-${Date.now()}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id,
      contributed: overrides.contributed ?? 0n,
      consumed: overrides.consumed ?? 0n
    }
  });
};

const createContribution = async (
  userId: number,
  sizeBytes = 1_000_000,
  ratioExempt: RatioExempt = RatioExempt.NONE
) => {
  const community = await testPrisma.community.create({
    data: {
      name: `LG-Community-${Date.now()}-${Math.random()}`,
      image: '',
      registrationStatus: RegistrationStatus.open,
      type: CommunityType.Music
    }
  });
  const artist = await testPrisma.artist.create({
    data: { name: `LG-Artist-${Date.now()}-${Math.random()}` }
  });
  const release = await testPrisma.release.create({
    data: {
      title: `LG-Release-${Date.now()}`,
      description: 'desc',
      type: ReleaseType.Music,
      releaseType: 'Album',
      year: 2020,
      credits: { create: { artistId: artist.id } }
    }
  });
  const edition = await testPrisma.edition.create({
    data: { releaseId: release.id }
  });
  const contributor = await testPrisma.contributor.upsert({
    where: { userId },
    update: {},
    create: { userId, communityId: community.id }
  });
  return testPrisma.contribution.create({
    data: {
      userId,
      releaseId: release.id,
      contributorId: contributor.id,
      editionId: edition.id,
      type: FileType.flac,
      downloadUrl: 'https://example.com/file.torrent',
      sizeInBytes: sizeBytes,
      approvedAccountingBytes: BigInt(sizeBytes),
      releaseDescription: 'test',
      ratioExempt
    }
  });
};

describe('getLedgerSnapshot', () => {
  it('returns per-user balances + policy state and per-contribution pass flags', async () => {
    const contributor = await createUser('snap-k', { contributed: 5_000_000n });
    const consumer = await createUser('snap-c', {
      contributed: 3_000_000n,
      consumed: 1_000_000n
    });
    const contribution = await createContribution(
      contributor.id,
      2_000_000,
      RatioExempt.FREEPASS
    );
    // A policy row that isn't the default, to prove it's surfaced.
    await testPrisma.ratioPolicyState.create({
      data: { userId: consumer.id, status: RatioPolicyStatus.WATCH }
    });

    const snap = await getLedgerSnapshot();

    const kRow = snap.users.find((u) => u.id === contributor.id);
    const cRow = snap.users.find((u) => u.id === consumer.id);
    expect(kRow).toMatchObject({
      contributed: '5000000',
      consumed: '0',
      canDownload: true,
      policyState: RatioPolicyStatus.OK // no row ⇒ default
    });
    expect(cRow).toMatchObject({
      consumed: '1000000',
      policyState: RatioPolicyStatus.WATCH
    });

    const cSnap = snap.contributions.find((c) => c.id === contribution.id);
    expect(cSnap).toMatchObject({
      userId: contributor.id,
      approvedAccountingBytes: '2000000',
      ratioExempt: RatioExempt.FREEPASS
    });
  });
});

describe('getNewConsumptionEvents', () => {
  it('emits one event per new grant with pre-resolved deltas (NONE and FREEPASS)', async () => {
    const contributor = await createUser('emit-k');
    const consumer = await createUser('emit-c', { contributed: 10_000_000n });
    const plain = await createContribution(contributor.id, 1_000_000);
    const free = await createContribution(
      contributor.id,
      1_000_000,
      RatioExempt.FREEPASS
    );

    const g1 = await grantDownloadAccess(consumer.id, plain.id);
    const g2 = await grantDownloadAccess(consumer.id, free.id);

    const events = await getNewConsumptionEvents(0);
    expect(events.map((e) => e.grantId)).toEqual([g1.grantId, g2.grantId]);

    const plainEvent = events.find((e) => e.grantId === g1.grantId);
    expect(plainEvent).toMatchObject({
      kind: 'grant',
      userId: consumer.id,
      contributorId: contributor.id,
      consumedDelta: '1000000',
      contributedDelta: '1000000',
      pass: 'none'
    });

    const freeEvent = events.find((e) => e.grantId === g2.grantId);
    expect(freeEvent).toMatchObject({
      consumedDelta: '0', // FREEPASS suppresses the consumer side
      contributedDelta: '1000000',
      pass: 'freepass'
    });

    // Cursor honored — nothing new after the last grant.
    expect(await getNewConsumptionEvents(g2.grantId)).toHaveLength(0);
  });
});

describe('grant-time canConsume gate (korin stubbed)', () => {
  const origFetch = global.fetch;
  const origApiUrl = korin.apiUrl;
  const origPullKey = korin.pullKey;

  beforeEach(() => {
    korin.apiUrl = 'http://korin.stub';
    korin.pullKey = 'stub-key';
  });
  afterEach(() => {
    global.fetch = origFetch;
    korin.apiUrl = origApiUrl;
    korin.pullKey = origPullKey;
  });

  it('blocks a non-exempt grant with 403 when korin says allow:false', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ allow: false, reason: 'LEECH_DISABLED' })
    }) as unknown as typeof fetch;

    const contributor = await createUser('gate-k');
    const consumer = await createUser('gate-c', { contributed: 10_000_000n });
    const contribution = await createContribution(contributor.id);

    await expect(
      grantDownloadAccess(consumer.id, contribution.id)
    ).rejects.toMatchObject({ statusCode: 403 });

    // Nothing accrued — the block happened before the transaction.
    const c = await testPrisma.user.findUniqueOrThrow({
      where: { id: consumer.id }
    });
    expect(c.consumed).toBe(0n);
  });

  it('lets an exempt (FREEPASS) grant through even when korin says allow:false', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ allow: false, reason: 'LEECH_DISABLED' })
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const contributor = await createUser('gate-fp-k');
    const consumer = await createUser('gate-fp-c', { contributed: 100n });
    const contribution = await createContribution(
      contributor.id,
      1_000_000,
      RatioExempt.FREEPASS
    );

    const result = await grantDownloadAccess(consumer.id, contribution.id);
    expect(result.status).toBe('COMPLETED');
    // The gate was never consulted for an exempt contribution.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails open — a network error lets the grant proceed on local checks', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;

    const contributor = await createUser('open-k');
    const consumer = await createUser('open-c', { contributed: 10_000_000n });
    const contribution = await createContribution(contributor.id);

    const result = await grantDownloadAccess(consumer.id, contribution.id);
    expect(result.status).toBe('COMPLETED');
  });
});
