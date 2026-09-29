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
  const token = 't'.repeat(64);
  const reset = () => resetPasswordWithToken(token, 'a long enough password');

  beforeEach(() => {
    prismaMock.accountRecovery.findFirst.mockResolvedValue({
      id: 3,
      userId: 7
    } as never);
    prismaMock.accountRecovery.updateMany.mockResolvedValue({
      count: 1
    } as never);
    prismaMock.user.update.mockResolvedValue({} as never);
    prismaMock.userSession.updateMany.mockResolvedValue({ count: 0 } as never);
  });

  // #764: the claim is the transaction's first write. Of two concurrent
  // resets, or one racing a newer request or a staff delete, the loser
  // matches nothing and is answered as an unknown token is.
  it('claims the token as the first write', async () => {
    await reset();
    expect(prismaMock.accountRecovery.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 3, usedAt: null, expiresAt: { gt: expect.any(Date) } },
      data: { usedAt: expect.any(Date) }
    });
    const [claim] =
      prismaMock.accountRecovery.updateMany.mock.invocationCallOrder;
    const writes = [
      ...prismaMock.user.update.mock.invocationCallOrder,
      ...prismaMock.userSession.updateMany.mock.invocationCallOrder
    ];
    expect(writes).toHaveLength(2);
    expect(writes.every((o) => o > claim)).toBe(true);
  });

  it('answers 400 and writes no password or sessions when the claim loses', async () => {
    prismaMock.accountRecovery.updateMany.mockResolvedValue({
      count: 0
    } as never);
    await expect(reset()).rejects.toEqual(
      expect.objectContaining({
        statusCode: 400,
        message: 'Invalid or expired recovery token'
      })
    );
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.userSession.updateMany).not.toHaveBeenCalled();
  });

  it("expires the member's other pending reset tokens", async () => {
    await reset();
    expect(prismaMock.accountRecovery.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        userId: 7,
        purpose: 'PasswordReset',
        usedAt: null,
        expiresAt: { gt: expect.any(Date) },
        id: { not: 3 }
      },
      data: { expiresAt: expect.any(Date) }
    });
  });

  it('checks the password and hashes it before the transaction', async () => {
    await reset();
    const [txStart] = prismaMock.$transaction.mock.invocationCallOrder;
    expect(
      prismaMock.badPassword.findUnique.mock.invocationCallOrder[0]
    ).toBeLessThan(txStart);
    expect(
      (bcryptMock as unknown as { hash: jest.Mock }).hash.mock
        .invocationCallOrder[0]
    ).toBeLessThan(txStart);
  });
});
