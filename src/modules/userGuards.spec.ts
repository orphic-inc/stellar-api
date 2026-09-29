/**
 * The constraint guards on user.ts writes (#758, ADR-0048). Each is proved by
 * failing its write with the code it translates. The sites not guarded are
 * recorded as internally derived; noHardDelete.spec.ts holds the fact most of
 * those reasons rest on.
 *
 * A file of its own rather than more of userModules.spec.ts, which is already
 * past the size Codacy flags on growth.
 */
import { Prisma } from '@prisma/client';
import { prismaMock, resetApiTestState } from '../test/apiTestHarness';
import type * as UserModule from './user';

const { createUser, deleteWarning, setUserRank, grantDonorStatus } =
  jest.requireActual<typeof UserModule>('./user');

const prismaErr = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test'
  });
const status = (code: number) => expect.objectContaining({ statusCode: code });

beforeEach(() => {
  resetApiTestState();
  prismaMock.$transaction.mockImplementation((async (arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock)
      : Promise.all(arg as Promise<unknown>[])) as never);
});

describe('createUser', () => {
  const input = { username: 'nova', email: 'n@x.test', password: 'pw' };

  beforeEach(() => {
    prismaMock.userSettings.create.mockResolvedValue({ id: 1 } as never);
    prismaMock.profile.create.mockResolvedValue({ id: 2 } as never);
  });

  // The live bug: `userRankId` comes from the body and nothing checked it.
  it('answers 400 when the body names no rank', async () => {
    prismaMock.user.create.mockRejectedValue(prismaErr('P2003'));
    await expect(createUser({ ...input, userRankId: 999 }, 1)).rejects.toEqual(
      status(400)
    );
  });

  it('answers 400 when a racing create took the name, as the pre-check does', async () => {
    prismaMock.user.create.mockRejectedValue(prismaErr('P2002'));
    await expect(createUser({ ...input, userRankId: 1 }, 1)).rejects.toEqual(
      expect.objectContaining({
        statusCode: 400,
        message: 'User already exists'
      })
    );
  });
});

describe('deleteWarning', () => {
  it('answers 404 when a racing delete removed the warning first', async () => {
    prismaMock.userWarning.findUnique.mockResolvedValue({
      id: 3,
      userId: 7
    } as never);
    prismaMock.userWarning.delete.mockRejectedValue(prismaErr('P2025'));
    await expect(deleteWarning(7, 3)).rejects.toEqual(status(404));
  });
});

describe('setUserRank', () => {
  it('answers 404 when the rank was deleted after the check', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 7 } as never);
    prismaMock.userRank.findMany.mockResolvedValue([
      { id: 2, secondary: false }
    ] as never);
    prismaMock.user.update.mockRejectedValue(prismaErr('P2003'));
    await expect(setUserRank(7, 2, [], 1)).rejects.toEqual(status(404));
  });
});

describe('grantDonorStatus', () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 7 } as never);
    prismaMock.donorRank.findUnique.mockResolvedValue({
      id: 4,
      expiresAfterDays: null
    } as never);
  });

  it('answers 409 when a concurrent grant inserted first', async () => {
    prismaMock.userDonorRank.upsert.mockRejectedValue(prismaErr('P2002'));
    await expect(grantDonorStatus(7, 4, null, 1)).rejects.toEqual(status(409));
  });

  it('answers 404 when the donor rank was deleted after the check', async () => {
    prismaMock.userDonorRank.upsert.mockRejectedValue(prismaErr('P2003'));
    await expect(grantDonorStatus(7, 4, null, 1)).rejects.toEqual(status(404));
  });
});
