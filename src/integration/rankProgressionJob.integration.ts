import {
  ReleaseType,
  FileType,
  CommunityType,
  RegistrationStatus
} from '@prisma/client';
import { truncateAll, testPrisma } from '../test/dbHelpers';
import { seedRanks, seedRankPromotionRules } from '../modules/bootstrap';
import { createContributionSubmission } from '../modules/contribution';
import { runRankProgressionSweep } from '../modules/rankProgressionJob';
import type { CreateContributionInput } from '../schemas/contribution';

// The async link-health HTTP check fires after each contribution and holds a
// connection that blocks the next TRUNCATE — stub it (mirrors contributions.integration).
jest.mock('../modules/linkHealth', () => ({
  checkContributionLink: jest.fn().mockResolvedValue(undefined)
}));

const GiB = BigInt(1024 ** 3);

beforeEach(async () => {
  await truncateAll();
  // Seed the real ladder + promotion rules (#168 seeders) — the sweep reads them.
  await seedRanks(testPrisma);
  await seedRankPromotionRules(testPrisma);
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const rankIdByLevel = async (level: number): Promise<number> => {
  const rank = await testPrisma.userRank.findFirstOrThrow({ where: { level } });
  return rank.id;
};

let userSeq = 0;
const createUserAt = async (
  level: number,
  opts: { rankLocked?: boolean; consumed?: bigint; ageDays?: number } = {}
) => {
  userSeq += 1;
  const tag = `rp-${userSeq}-${Date.now()}`;
  const [rankId, settings, profile] = await Promise.all([
    rankIdByLevel(level),
    testPrisma.userSettings.create({ data: {} }),
    testPrisma.profile.create({ data: {} })
  ]);
  return testPrisma.user.create({
    data: {
      username: tag,
      email: `${tag}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rankId,
      userSettingsId: settings.id,
      profileId: profile.id,
      consumed: opts.consumed ?? 0n,
      rankLocked: opts.rankLocked ?? false,
      dateRegistered: new Date(Date.now() - (opts.ageDays ?? 0) * 86_400_000)
    }
  });
};

const createCommunity = () =>
  testPrisma.community.create({
    data: {
      name: `Community-${Date.now()}-${userSeq}`,
      image: '',
      registrationStatus: RegistrationStatus.open,
      type: CommunityType.Music
    }
  });

const baseInput = (communityId: number): CreateContributionInput => ({
  communityId,
  type: ReleaseType.Music,
  title: `Album-${Date.now()}-${userSeq}`,
  year: 2020,
  fileType: FileType.flac,
  downloadUrl: 'https://example.com/file.torrent',
  sizeInBytes: 1_000_000,
  tags: 'rock',
  releaseDescription: 'desc',
  image: undefined,
  description: undefined,
  bitrate: undefined,
  media: undefined,
  releaseCategory: undefined,
  recordLabel: undefined,
  catalogueNumber: undefined,
  editionTitle: undefined,
  editionYear: undefined,
  isRemaster: false,
  hasLog: false,
  hasCue: false,
  isScene: false,
  collaborators: [{ artist: 'Test Artist', importance: 'main' }]
});

// Give a user an accounted, link-healthy, past-the-72h-window contribution so it
// counts toward eligible bytes (ADR-0006).
const giveEligibleBytes = async (
  userId: number,
  communityId: number,
  bytes: bigint
) => {
  const contribution = await createContributionSubmission({
    userId,
    input: baseInput(communityId)
  });
  if (!contribution) throw new Error('fixture contribution failed');
  await testPrisma.contribution.update({
    where: { id: contribution.id },
    data: {
      approvedAccountingBytes: bytes,
      createdAt: new Date(Date.now() - 10 * 86_400_000) // 10 days old > 72h window
    }
  });
};

describe('runRankProgressionSweep', () => {
  it('promotes, demotes, and respects Staff / locked freezes in one pass', async () => {
    const [userLevel, memberLevel, staffLevel] = await Promise.all([
      rankIdByLevel(100),
      rankIdByLevel(150),
      rankIdByLevel(500)
    ]);

    // System actor: the install SysOp must exist for the sweep to attribute changes.
    await createUserAt(1000);

    const community = await createCommunity();

    // 1) A User who clears every User→Member bar (10 GiB / 0.70 / 0 / 7d).
    const promoting = await createUserAt(100, { ageDays: 30 });
    await giveEligibleBytes(promoting.id, community.id, 20n * GiB);

    // 2) A Member with no eligible bytes — lapsed the stock criteria for Member.
    const demoting = await createUserAt(150, { ageDays: 60 });

    // 3) A Staff user — assigned, never auto-managed.
    const staff = await createUserAt(500, { ageDays: 365 });

    // 4) A fully-eligible User who is rankLocked — the engine must not touch them.
    const locked = await createUserAt(100, { ageDays: 30, rankLocked: true });
    await giveEligibleBytes(locked.id, community.id, 20n * GiB);

    const result = await runRankProgressionSweep();

    expect(result).toEqual({ scanned: 3, promoted: 1, demoted: 1 });

    const after = async (id: number) =>
      (await testPrisma.user.findUniqueOrThrow({ where: { id } })).userRankId;

    expect(await after(promoting.id)).toBe(memberLevel); // → Member
    expect(await after(demoting.id)).toBe(userLevel); // → User (demoted)
    expect(await after(staff.id)).toBe(staffLevel); // unchanged
    expect(await after(locked.id)).toBe(userLevel); // unchanged (frozen)

    // Audit trail: one rank_changed per actual move, flagged auto.
    const auditRows = await testPrisma.auditLog.findMany({
      where: { action: 'user.rank_changed' }
    });
    expect(auditRows).toHaveLength(2);
    expect(
      auditRows.every((r) => (r.metadata as { auto?: boolean }).auto === true)
    ).toBe(true);

    // Notifications: the promoted user gets rank_promoted, the demoted rank_demoted.
    const promoteNotif = await testPrisma.notification.findFirst({
      where: { userId: promoting.id, type: 'rank_promoted' }
    });
    const demoteNotif = await testPrisma.notification.findFirst({
      where: { userId: demoting.id, type: 'rank_demoted' }
    });
    expect(promoteNotif).not.toBeNull();
    expect(demoteNotif).not.toBeNull();

    // The locked user got no notification.
    const lockedNotif = await testPrisma.notification.findFirst({
      where: { userId: locked.id }
    });
    expect(lockedNotif).toBeNull();
  });

  it('no-ops cleanly when there is no SysOp actor', async () => {
    const community = await createCommunity();
    const eligible = await createUserAt(100, { ageDays: 30 });
    await giveEligibleBytes(eligible.id, community.id, 20n * GiB);

    const result = await runRankProgressionSweep();

    expect(result).toEqual({ scanned: 0, promoted: 0, demoted: 0 });
    const userLevel = await rankIdByLevel(100);
    expect(
      (await testPrisma.user.findUniqueOrThrow({ where: { id: eligible.id } }))
        .userRankId
    ).toBe(userLevel);
  });
});
