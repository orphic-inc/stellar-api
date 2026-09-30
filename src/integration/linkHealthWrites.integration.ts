import { randomUUID } from 'node:crypto';
import {
  CommunityType,
  LinkHealthStatus,
  RegistrationStatus
} from '@prisma/client';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { prisma } from '../lib/prisma';
import { seedE2eRelease } from '../modules/e2eFixtures';
import {
  checkContributionLink,
  recordContributionReport,
  sweepStaleWarnLinks
} from '../modules/linkHealth';

/**
 * Link-state writes swap on the state they were computed from (#807), against
 * real rows: the swap matches a timestamp and a null, which only a real database
 * proves, and a writer that read before another landed must not undo it.
 *
 * The fixture's link is on the reserved `.test` TLD, so a real check fails at
 * the egress guard's DNS lookup rather than dialling anything.
 */
beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await testPrisma.$disconnect();
});

const DAY_MS = 86_400_000;

/** One contribution, its link state set to `state`. */
const contributionWith = async (state: {
  linkStatus: LinkHealthStatus;
  linkStatusChangedAt: Date;
  healthyMs: bigint;
  healthySince: Date | null;
}) => {
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  const tag = randomUUID().slice(0, 8);
  const user = await testPrisma.user.create({
    data: {
      username: `lw-${tag}`,
      email: `lw-${tag}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
  await testPrisma.community.create({
    data: {
      name: `Community-${tag}`,
      image: '',
      registrationStatus: RegistrationStatus.open,
      type: CommunityType.Music
    }
  });
  const { contributionId } = await seedE2eRelease(testPrisma, user.id);
  await testPrisma.contribution.update({
    where: { id: contributionId },
    data: { downloadUrl: 'https://link-health.test/file', ...state }
  });
  return { contributionId, userId: user.id };
};

const linkOf = (id: number) =>
  testPrisma.contribution.findUniqueOrThrow({
    where: { id },
    select: { linkStatus: true, healthyMs: true, healthySince: true }
  });

describe('a link check', () => {
  it('writes over the state it read, matching its timestamp', async () => {
    const since = new Date(Date.now() - 2 * DAY_MS);
    const { contributionId } = await contributionWith({
      linkStatus: LinkHealthStatus.PASS,
      linkStatusChangedAt: since,
      healthyMs: 0n,
      healthySince: since
    });

    await checkContributionLink(contributionId);

    // FAIL banks the open two-day segment. Had the swap not matched the stored
    // timestamp, it would have given up and left the row PASS.
    const after = await linkOf(contributionId);
    expect(after.linkStatus).toBe(LinkHealthStatus.FAIL);
    expect(after.healthySince).toBeNull();
    expect(after.healthyMs).toBeGreaterThanOrEqual(BigInt(2 * DAY_MS));
  });

  it('that read before a report banked the segment does not count it again (#807)', async () => {
    const since = new Date(Date.now() - 2 * DAY_MS);
    // What a report wrote after the check read: WARN, one day banked.
    const { contributionId } = await contributionWith({
      linkStatus: LinkHealthStatus.WARN,
      linkStatusChangedAt: new Date(Date.now() - DAY_MS),
      healthyMs: BigInt(DAY_MS),
      healthySince: null
    });
    // What the check read before that: PASS, accruing since two days ago.
    const staleRead = {
      downloadUrl: 'https://link-health.test/file',
      linkStatus: LinkHealthStatus.PASS,
      linkStatusChangedAt: since,
      healthyMs: 0n,
      healthySince: since
    };
    jest
      .spyOn(prisma.contribution, 'findUnique')
      .mockImplementationOnce((() => Promise.resolve(staleRead)) as never);

    await checkContributionLink(contributionId);

    // Computed from the stale read, FAIL would have banked the whole two days
    // over the report's one. Recomputed from the row, nothing is open to bank.
    const after = await linkOf(contributionId);
    expect(after.linkStatus).toBe(LinkHealthStatus.FAIL);
    expect(after.healthyMs).toBe(BigInt(DAY_MS));
  });
});

describe('each half of the swap, alone (#807)', () => {
  const HOUR_MS = 3_600_000;

  /** Serve the next contribution read from `row`: what a writer saw earlier. */
  const staleRead = (row: object) =>
    jest
      .spyOn(prisma.contribution, 'findUnique')
      .mockImplementationOnce((() => Promise.resolve(row)) as never);

  it('healthySince: a check banks the segment the row holds, not the one it read', async () => {
    // Meanwhile the link went PASS → FAIL → PASS: a day banked, a new segment
    // an hour old. The status reads PASS both times.
    const { contributionId } = await contributionWith({
      linkStatus: LinkHealthStatus.PASS,
      linkStatusChangedAt: new Date(Date.now() - HOUR_MS),
      healthyMs: BigInt(DAY_MS),
      healthySince: new Date(Date.now() - HOUR_MS)
    });
    const since = new Date(Date.now() - 2 * DAY_MS);
    staleRead({
      downloadUrl: 'https://link-health.test/file',
      linkStatus: LinkHealthStatus.PASS,
      linkStatusChangedAt: since,
      healthyMs: 0n,
      healthySince: since
    });

    await checkContributionLink(contributionId);

    // About a day and an hour. From the stale read it would be two days.
    const { healthyMs } = await linkOf(contributionId);
    expect(healthyMs).toBeGreaterThan(BigInt(DAY_MS + HOUR_MS - 60_000));
    expect(healthyMs).toBeLessThan(BigInt(DAY_MS + 2 * HOUR_MS));
  });

  it('linkStatus: a report does not warn over a FAIL it read as PASS', async () => {
    // A check failed the link after the report read it; neither has a segment
    // open, so only the status tells them apart.
    const { contributionId } = await contributionWith({
      linkStatus: LinkHealthStatus.FAIL,
      linkStatusChangedAt: new Date(),
      healthyMs: 0n,
      healthySince: null
    });
    for (let i = 0; i < 3; i += 1) {
      const reporter = await testPrisma.user.create({
        data: {
          username: `lw-r${i}-${contributionId}`,
          email: `lw-r${i}-${contributionId}@example.com`,
          password: 'x',
          avatar: '',
          userRankId: (await testPrisma.userRank.findFirstOrThrow()).id,
          userSettingsId: (await testPrisma.userSettings.create({ data: {} }))
            .id,
          profileId: (await testPrisma.profile.create({ data: {} })).id
        }
      });
      await testPrisma.contributionReport.create({
        data: { contributionId, reporterId: reporter.id, reason: 'dead' }
      });
    }
    // A backfilled PASS: no segment was ever opened.
    staleRead({
      linkStatus: LinkHealthStatus.PASS,
      linkStatusChangedAt: null,
      healthyMs: 0n,
      healthySince: null
    });

    const reporterId = (
      await testPrisma.contributionReport.findFirstOrThrow({
        where: { contributionId }
      })
    ).reporterId;
    await recordContributionReport(contributionId, reporterId, 'dead');

    expect((await linkOf(contributionId)).linkStatus).toBe(
      LinkHealthStatus.FAIL
    );
  });
});

describe('the WARN sweep', () => {
  it('does not fail a link a check proved healthy after the sweep read it (#807)', async () => {
    const { contributionId, userId } = await contributionWith({
      linkStatus: LinkHealthStatus.PASS,
      linkStatusChangedAt: new Date(),
      healthyMs: 0n,
      healthySince: new Date()
    });
    // The sweep read it while it was still a stale WARN.
    const staleRead = [
      { id: contributionId, userId, release: { title: 'Recovered' } }
    ];
    jest
      .spyOn(prisma.contribution, 'findMany')
      .mockImplementationOnce((() => Promise.resolve(staleRead)) as never);

    await sweepStaleWarnLinks();

    expect((await linkOf(contributionId)).linkStatus).toBe(
      LinkHealthStatus.PASS
    );
  });
});
