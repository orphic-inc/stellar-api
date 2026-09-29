/**
 * The constraint guards on contribution.ts writes (#596, ADR-0048). Each is
 * proved by failing its write with the code it translates. The sites not
 * guarded are recorded as internally derived; noHardDelete.spec.ts holds the
 * facts most of those reasons rest on.
 */
import { FileType, Prisma, ReleaseType } from '@prisma/client';
import { prismaMock, resetApiTestState } from '../test/apiTestHarness';
import type * as ContributionModule from './contribution';
import type { CreateContributionInput } from '../schemas/contribution';

const { createContributionSubmission, addContributionToRelease } =
  jest.requireActual<typeof ContributionModule>('./contribution');

const prismaErr = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test'
  });

const OPEN = { id: 1, registrationStatus: 'open' } as never;

beforeEach(() => {
  resetApiTestState();
  prismaMock.$transaction.mockImplementation((async (arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock)
      : Promise.all(arg as Promise<unknown>[])) as never);
  prismaMock.tagAlias.findMany.mockResolvedValue([]);
  prismaMock.artist.findMany.mockResolvedValue([
    { id: 9, name: 'Miles Davis' }
  ] as never);
});

const refusal = (statusCode: number, message: string) =>
  expect.objectContaining({ statusCode, message });

describe('createContributionSubmission', () => {
  const submit = () =>
    createContributionSubmission({
      userId: 7,
      input: {
        communityId: 1,
        type: ReleaseType.Music,
        title: 'Kind of Blue',
        year: 1959,
        fileType: FileType.flac,
        downloadUrl: 'https://example.com/file.torrent',
        sizeInBytes: 1_000_000,
        releaseDescription: 'd',
        collaborators: [{ artist: 'Miles Davis', importance: 'Main' }]
      } as CreateContributionInput
    });

  beforeEach(() => {
    prismaMock.community.findUnique.mockResolvedValue(OPEN);
  });

  // Prisma runs this upsert as a read then an insert, so two first uploads by
  // one member race on Contributor.userId.
  it('answers 409 when a racing upload recorded the contributor first', async () => {
    prismaMock.contributor.upsert.mockRejectedValue(prismaErr('P2002'));
    await expect(submit()).rejects.toEqual(
      refusal(409, 'Another upload is recording your contributor role; retry')
    );
    expect(prismaMock.release.create).not.toHaveBeenCalled();
  });

  it.each(['P2025', 'P2003'])(
    'answers the missing-community 404 when the community went (%s)',
    async (code) => {
      prismaMock.contributor.upsert.mockRejectedValue(prismaErr(code));
      await expect(submit()).rejects.toEqual(
        refusal(404, 'Community not found')
      );
    }
  );

  it('answers the missing-community 404 when the release write finds it gone', async () => {
    prismaMock.contributor.upsert.mockResolvedValue({ id: 4 } as never);
    prismaMock.release.create.mockRejectedValue(prismaErr('P2003'));
    await expect(submit()).rejects.toEqual(refusal(404, 'Community not found'));
    expect(prismaMock.contribution.create).not.toHaveBeenCalled();
  });
});

describe('addContributionToRelease', () => {
  const attach = () =>
    addContributionToRelease({
      userId: 7,
      communityId: 1,
      releaseId: 5,
      input: {
        fileType: FileType.flac,
        downloadUrl: 'https://example.com/file.torrent',
        sizeInBytes: 1_000_000,
        releaseDescription: 'd'
      } as never
    });

  beforeEach(() => {
    prismaMock.release.findFirst.mockResolvedValue({
      id: 5,
      year: 2020,
      type: ReleaseType.Music,
      community: OPEN
    } as never);
  });

  it('answers the missing-release 404 when the community went (P2025)', async () => {
    prismaMock.contributor.upsert.mockRejectedValue(prismaErr('P2025'));
    await expect(attach()).rejects.toEqual(refusal(404, 'Release not found'));
  });

  it('answers the missing-release 404 when an edition-less release went', async () => {
    prismaMock.contributor.upsert.mockResolvedValue({ id: 4 } as never);
    prismaMock.edition.findFirst.mockResolvedValue(null);
    prismaMock.edition.create.mockRejectedValue(prismaErr('P2003'));
    await expect(attach()).rejects.toEqual(refusal(404, 'Release not found'));
    expect(prismaMock.contribution.create).not.toHaveBeenCalled();
  });

  it('attaches to the existing edition without creating one', async () => {
    prismaMock.contributor.upsert.mockResolvedValue({ id: 4 } as never);
    prismaMock.edition.findFirst.mockResolvedValue({ id: 2 } as never);
    prismaMock.contribution.create.mockResolvedValue({
      id: 11,
      sizeInBytes: BigInt(1_000_000)
    } as never);
    // The harness's linkHealth stub has no checkContributionLink, so the
    // post-commit link check rejects; only the transaction is under test.
    await attach().catch(() => undefined);
    expect(prismaMock.edition.create).not.toHaveBeenCalled();
    expect(prismaMock.contribution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ editionId: 2, contributorId: 4 })
      })
    );
  });
});
