import { randomUUID } from 'node:crypto';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { prisma } from '../lib/prisma';
import {
  claimReport,
  fileReport,
  resolveReport,
  unclaimReport
} from '../modules/reports';

/**
 * Claim and unclaim are compare-and-swaps (#802), against real rows: the swap's
 * `OR` over a nullable `claimedById` is only proved by a real database, and a
 * resolve that lands after a staff member loaded the report must stay resolved.
 */
beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const createUser = async () => {
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  const tag = randomUUID().slice(0, 8);
  return testPrisma.user.create({
    data: {
      username: `rc-${tag}`,
      email: `rc-${tag}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
};

const openReport = async () => {
  const reporter = await createUser();
  const { report } = await fileReport(reporter.id, {
    targetType: 'User',
    targetId: reporter.id,
    category: 'other',
    reason: 'test'
  });
  return report.id;
};

const stateOf = (id: number) =>
  testPrisma.report.findUniqueOrThrow({
    where: { id },
    select: { status: true, claimedById: true }
  });

/**
 * Serve the next report read from `row`: the report as a staff member loaded it,
 * before the resolve landed. Before #802 that read decided the write; a swap
 * reads only after it missed, so there it merely picks the refusal.
 */
const staleRead = (row: { status: string; claimedById: number | null }) =>
  jest
    .spyOn(prisma.report, 'findUnique')
    .mockImplementationOnce((() => Promise.resolve(row)) as never);

afterEach(() => jest.restoreAllMocks());

describe('claiming a report', () => {
  it('claims an open report, re-claims your own, and refuses one held by another', async () => {
    const [alice, bob] = [await createUser(), await createUser()];
    const id = await openReport();

    expect(await claimReport(id, alice.id)).toEqual({ ok: true });
    expect(await claimReport(id, alice.id)).toEqual({ ok: true });
    expect(await claimReport(id, bob.id)).toEqual({
      ok: false,
      reason: 'already_claimed'
    });
    expect(await stateOf(id)).toEqual({
      status: 'Claimed',
      claimedById: alice.id
    });
  });

  it('leaves a report resolved after the claimer loaded it resolved (#802)', async () => {
    const staff = await createUser();
    const id = await openReport();
    await resolveReport(id, staff.id, 'done', 'Dismissed');

    staleRead({ status: 'Open', claimedById: null });
    expect((await claimReport(id, staff.id)).ok).toBe(false);

    expect(await stateOf(id)).toEqual({
      status: 'Resolved',
      claimedById: null
    });
  });
});

describe('unclaiming a report', () => {
  it('releases your own claim, and refuses when the claim is not yours', async () => {
    const [alice, bob] = [await createUser(), await createUser()];
    const id = await openReport();
    await claimReport(id, alice.id);

    expect(await unclaimReport(id, bob.id)).toEqual({
      ok: false,
      reason: 'forbidden'
    });
    expect(await unclaimReport(id, alice.id)).toEqual({ ok: true });
    expect(await stateOf(id)).toEqual({ status: 'Open', claimedById: null });
  });

  it('leaves a report resolved after the claimer loaded it resolved (#802)', async () => {
    const staff = await createUser();
    const id = await openReport();
    await claimReport(id, staff.id);
    await resolveReport(id, staff.id, 'done', 'Dismissed');

    staleRead({ status: 'Claimed', claimedById: staff.id });
    expect((await unclaimReport(id, staff.id)).ok).toBe(false);

    expect(await stateOf(id)).toEqual({
      status: 'Resolved',
      claimedById: null
    });
  });
});
