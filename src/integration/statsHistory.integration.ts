/**
 * Integration coverage for the site stat snapshot's lost insert (#844).
 *
 * `captureSiteStats` upserts the hour's bucket with an empty `update`, which
 * Prisma runs as a read then an insert rather than ON CONFLICT. The hourly job
 * and an admin's `POST /stats/snapshot` in the same hour can both insert; the
 * loser meets the unique `bucketAt`, and the bucket is already captured.
 */
import { Prisma } from '@prisma/client';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { prisma } from '../lib/prisma';
import { captureSiteStats } from '../modules/statsHistory';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe('captureSiteStats — two captures in one hour', () => {
  it('keeps the first capture when the second loses the insert', async () => {
    // The winner inserts between the loser's read and its insert, so the
    // loser's insert meets the unique bucketAt for real.
    jest
      .spyOn(prisma.siteStatSnapshot, 'upsert')
      .mockImplementationOnce(((args: Prisma.SiteStatSnapshotUpsertArgs) =>
        testPrisma.siteStatSnapshot
          .create({ data: { ...args.create, totalUsers: 4242 } })
          .then(() =>
            testPrisma.siteStatSnapshot.create({ data: args.create })
          )) as never);

    await expect(captureSiteStats()).resolves.toBeUndefined();
    const rows = await testPrisma.siteStatSnapshot.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].totalUsers).toBe(4242);
  });
});
