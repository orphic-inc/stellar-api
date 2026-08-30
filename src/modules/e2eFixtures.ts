/**
 * Content fixtures for the Playwright E2E suite — the release half of what
 * `src/scripts/seed-e2e-users.ts` plants (that script owns the accounts and the
 * invite subtree; this owns the thing they browse to).
 *
 * Why a release must be seeded at all: `stellar-ui/e2e/release.spec.ts` needs
 * one community holding one release, and says so in its own assertion message —
 * "No releases found — seed at least one release in the test community". Without
 * it P-06 fails structurally and P-07a/P-07b cascade, because both derive their
 * target URL from the release P-06 discovers (#339).
 *
 * Why a *contribution* is seeded too: P-07b reports a dead link on an existing
 * contribution, and calls `test.skip()` when the release has none. P-07a does
 * submit a contribution, but through the contribute form, which does not
 * reliably land it on this release — so without this row P-07b stays
 * permanently skipped, which is the quiet version of the red-by-default problem
 * this fixture exists to fix.
 *
 * Lives here rather than in the script so it takes a `PrismaClient` like every
 * other seeder in this repo (`seedRanks`, `seedGoldenRules`, `seedAll`), which
 * is what lets an integration test drive it against a real database. The
 * production refusal stays on the CLI entry point in the script — this module is
 * inert on import.
 *
 * Idempotent by identity: re-running finds the existing rows rather than
 * duplicating them, matching the guarantee the e2e seeder's docstring makes.
 */
import {
  PrismaClient,
  ReleaseType,
  ReleaseCategory,
  ArtistRole,
  FileType
} from '@prisma/client';

/**
 * The fixture's identities. These are a contract with
 * `stellar-ui/e2e/release.spec.ts` in the same way the fixture usernames are a
 * contract with `invite.spec.ts` — the spec locates them by browsing, not by
 * name, but anything asserting on them reads these strings.
 */
export const E2E_ARTIST_NAME = 'E2E Fixture Artist';
export const E2E_RELEASE_TITLE = 'E2E Fixture Release';
export const E2E_RELEASE_YEAR = 2026;
export const E2E_DOWNLOAD_URL =
  'https://example.com/e2e-fixture/e2e-fixture-release.flac';

export interface SeededE2eRelease {
  communityId: number;
  releaseId: number;
  contributionId: number;
}

/**
 * Plant one browsable release, credited to one artist, carrying one
 * contribution owned by `contributorUserId`.
 *
 * The contribution is deliberately owned by a user other than the E2E login
 * (`e2e_alpha`, not `testuser`): P-07b reports it, and reporting someone else's
 * contribution is the realistic path through that flow.
 */
export async function seedE2eRelease(
  client: PrismaClient,
  contributorUserId: number
): Promise<SeededE2eRelease> {
  // Lowest id, not a lookup by configured site name: `STELLAR_SITE_NAME` can
  // differ between the environment that ran /install and the one running this,
  // and the lowest-id community is what the spec's "first community in the
  // list" lands on anyway.
  const community = await client.community.findFirst({
    orderBy: { id: 'asc' },
    select: { id: true }
  });
  if (!community) {
    throw new Error(
      'No Community exists. The default community is created by POST /api/install — not by `npm run db:seed` — so complete setup at /install before seeding e2e fixtures.'
    );
  }

  // Artist.name is not unique, so find-then-create rather than upsert.
  const artist =
    (await client.artist.findFirst({
      where: { name: E2E_ARTIST_NAME },
      select: { id: true }
    })) ??
    (await client.artist.create({
      data: { name: E2E_ARTIST_NAME },
      select: { id: true }
    }));

  // Release.title is not unique either. The Main credit and the edition are
  // created inline, mirroring `createCommunityRelease` — the credit because
  // `withPrimaryArtist` derives the browse table's artist column from it, and
  // the edition because `Contribution.editionId` is required.
  const release =
    (await client.release.findFirst({
      where: { title: E2E_RELEASE_TITLE, communityId: community.id },
      select: { id: true }
    })) ??
    (await client.release.create({
      data: {
        communityId: community.id,
        title: E2E_RELEASE_TITLE,
        description:
          'Fixture release for the Playwright E2E suite. Safe to delete outside a test stack.',
        type: ReleaseType.Music,
        releaseType: ReleaseCategory.Album,
        year: E2E_RELEASE_YEAR,
        credits: { create: { artistId: artist.id, role: ArtistRole.Main } },
        editions: {
          create: { year: E2E_RELEASE_YEAR, isUnknownEdition: true }
        }
      },
      select: { id: true }
    }));

  const edition = await client.edition.findFirst({
    where: { releaseId: release.id },
    orderBy: { id: 'asc' },
    select: { id: true }
  });
  if (!edition) {
    // Only reachable if a prior run created the release without its edition.
    throw new Error(
      `Release ${release.id} has no Edition — cannot attach the fixture contribution. Delete the release and re-run.`
    );
  }

  // Contributor.userId is @unique: one row per user, carrying the community.
  const contributor = await client.contributor.upsert({
    where: { userId: contributorUserId },
    create: { userId: contributorUserId, communityId: community.id },
    update: { communityId: community.id },
    select: { id: true }
  });

  const existing = await client.contribution.findFirst({
    where: { releaseId: release.id },
    orderBy: { id: 'asc' },
    select: { id: true }
  });
  const contribution =
    existing ??
    (await client.contribution.create({
      data: {
        userId: contributorUserId,
        releaseId: release.id,
        contributorId: contributor.id,
        editionId: edition.id,
        downloadUrl: E2E_DOWNLOAD_URL,
        type: FileType.flac,
        sizeInBytes: 1_073_741_824n
      },
      select: { id: true }
    }));

  return {
    communityId: community.id,
    releaseId: release.id,
    contributionId: contribution.id
  };
}
