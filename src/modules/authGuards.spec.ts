/**
 * The constraint guards on auth.ts writes (#596, ADR-0048). Each is proved by
 * failing its write with the code it translates. The sites not guarded are
 * recorded as internally derived; noHardDelete.spec.ts holds the fact most of
 * those reasons rest on.
 */
import { Prisma } from '@prisma/client';
import {
  bcryptMock,
  prismaMock,
  resetApiTestState
} from '../test/apiTestHarness';
import type * as AuthModule from './auth';

const { registerUser, changeEmail, resetPasswordWithToken } =
  jest.requireActual<typeof AuthModule>('./auth');

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
  prismaMock.badPassword.findUnique.mockResolvedValue(null);
  prismaMock.emailBlacklist.findFirst.mockResolvedValue(null);
});

describe('registerUser', () => {
  beforeEach(() => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.userRank.findFirst.mockResolvedValue({ id: 1 } as never);
    prismaMock.$executeRaw.mockResolvedValue(1 as never);
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.stylesheet.findFirst.mockResolvedValue({ name: 'x' } as never);
    prismaMock.userSettings.create.mockResolvedValue({ id: 1 } as never);
    prismaMock.profile.create.mockResolvedValue({ id: 2 } as never);
  });

  // The pre-check runs before the transaction, so a racing registration can
  // take the address after it. The answer is the pre-check's own.
  it('answers user_exists when a racing registration took the address', async () => {
    prismaMock.user.create.mockRejectedValue(prismaErr('P2002'));
    await expect(
      registerUser({
        username: 'nova',
        email: 'n@x.test',
        password: 'a long enough password',
        registrationMode: 'open',
        maxUsers: 100
      })
    ).resolves.toEqual({ ok: false, reason: 'user_exists' });
  });
});

describe('changeEmail', () => {
  it('answers 400 when a racing account took the address', async () => {
    // The harness mocks bcryptjs; the password check is not what is under test.
    bcryptMock.compare.mockResolvedValue(true as never);
    prismaMock.user.findUnique
      .mockResolvedValueOnce({
        id: 7,
        email: 'old@x.test',
        password: 'hashed'
      } as never)
      .mockResolvedValueOnce(null);
    prismaMock.user.update.mockRejectedValue(prismaErr('P2002'));
    await expect(
      changeEmail(7, 'new@x.test', 'pw', '127.0.0.1')
    ).rejects.toEqual(
      expect.objectContaining({
        statusCode: 400,
        message: 'Email already in use'
      })
    );
  });
});

describe('resetPasswordWithToken', () => {
  it('answers 400 when staff deleted the recovery request mid-reset', async () => {
    prismaMock.accountRecovery.findFirst.mockResolvedValue({
      id: 3,
      userId: 7
    } as never);
    prismaMock.accountRecovery.update.mockRejectedValue(prismaErr('P2025'));
    await expect(
      resetPasswordWithToken('t'.repeat(64), 'a long enough password')
    ).rejects.toEqual(status(400));
  });
});
