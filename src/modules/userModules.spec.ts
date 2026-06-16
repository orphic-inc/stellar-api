/**
 * Unit tests for the newly extracted user and auth module functions.
 */

import bcrypt from 'bcryptjs';
import { prismaMock, resetApiTestState } from '../test/apiTestHarness';
import type * as UserModule from './user';
import type * as AuthModule from './auth';

const {
  getSnatchList,
  getInviteTree,
  getDuplicateIps,
  warnUser,
  deleteWarning,
  setUserRank,
  grantDonorStatus,
  getUserIpHistory,
  updateStaffBio
} = jest.requireActual<typeof UserModule>('./user');

const {
  changePassword,
  changeEmail,
  persistRecoveryToken,
  resetPasswordWithToken,
  generateRecoveryToken
} = jest.requireActual<typeof AuthModule>('./auth');

beforeEach(() => resetApiTestState());

// ─── auth.changePassword ──────────────────────────────────────────────────────

describe('auth.changePassword', () => {
  beforeEach(() => {
    prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === 'function') return arg(prismaMock);
      return Promise.all(arg as Promise<unknown>[]);
    });
    prismaMock.user.update.mockResolvedValue({} as never);
    prismaMock.userSession.updateMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.badPassword.findFirst.mockResolvedValue(null);
  });

  it('throws 401 when user not found', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(changePassword(1, 'old', 'new')).rejects.toMatchObject({
      statusCode: 401
    });
  });

  it('throws 400 when current password is wrong', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      password: '$2a$10$invalid'
    } as never);
    await expect(
      changePassword(1, 'wrongpass', 'newpass')
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'Current password is incorrect'
    });
  });

  it('throws 400 when new password is banned', async () => {
    // Use a real bcrypt hash so compare succeeds
    const hash = await bcrypt.hash('currentpass', 1);
    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      password: hash
    } as never);
    prismaMock.badPassword.findFirst.mockResolvedValue({
      password: 'newpass'
    } as never);
    await expect(
      changePassword(1, 'currentpass', 'newpass')
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

// ─── auth.changeEmail ─────────────────────────────────────────────────────────

describe('auth.changeEmail', () => {
  beforeEach(() => {
    prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === 'function') return arg(prismaMock);
      return Promise.all(arg as Promise<unknown>[]);
    });
    prismaMock.userEmailHistory.create.mockResolvedValue({} as never);
    prismaMock.user.update.mockResolvedValue({} as never);
  });

  it('throws 401 when user not found', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(
      changeEmail(1, 'new@example.com', 'pass', '1.2.3.4')
    ).rejects.toMatchObject({
      statusCode: 401
    });
  });

  it('throws 400 when password is wrong', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'old@example.com',
      password: '$2a$10$invalid'
    } as never);
    await expect(
      changeEmail(1, 'new@example.com', 'wrong', '1.2.3.4')
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'Password is incorrect'
    });
  });

  it('throws 400 when new email is already taken', async () => {
    const hash = await bcrypt.hash('pass', 1);
    prismaMock.user.findUnique
      .mockResolvedValueOnce({
        id: 1,
        email: 'old@example.com',
        password: hash
      } as never)
      .mockResolvedValueOnce({ id: 2, email: 'taken@example.com' } as never);
    await expect(
      changeEmail(1, 'taken@example.com', 'pass', '1.2.3.4')
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

// ─── auth.persistRecoveryToken ────────────────────────────────────────────────

describe('auth.persistRecoveryToken', () => {
  beforeEach(() => {
    prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === 'function') return arg(prismaMock);
      return Promise.all(arg as Promise<unknown>[]);
    });
    prismaMock.accountRecovery.updateMany.mockResolvedValue({
      count: 1
    } as never);
    prismaMock.accountRecovery.create.mockResolvedValue({ id: 1 } as never);
  });

  it('expires existing pending tokens before creating a new one', async () => {
    await persistRecoveryToken(7, 'abc123');

    expect(prismaMock.accountRecovery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 7, usedAt: null }),
        data: expect.objectContaining({ expiresAt: expect.any(Date) })
      })
    );
    expect(prismaMock.accountRecovery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 7, token: 'abc123' })
      })
    );
  });

  it('sets a 2-hour expiry on the new token', async () => {
    const before = Date.now();
    await persistRecoveryToken(7, 'abc123');
    const after = Date.now();

    const createCall = prismaMock.accountRecovery.create.mock.calls[0][0];
    const expiresAt = createCall.data.expiresAt as Date;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + 2 * 60 * 60 * 1000 - 100
    );
    expect(expiresAt.getTime()).toBeLessThanOrEqual(
      after + 2 * 60 * 60 * 1000 + 100
    );
  });
});

// ─── auth.generateRecoveryToken ──────────────────────────────────────────────

describe('auth.generateRecoveryToken', () => {
  it('returns a 64-character hex string', () => {
    const token = generateRecoveryToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns a different token each call', () => {
    const t1 = generateRecoveryToken();
    const t2 = generateRecoveryToken();
    expect(t1).not.toBe(t2);
  });
});

// ─── auth.resetPasswordWithToken ─────────────────────────────────────────────

describe('auth.resetPasswordWithToken', () => {
  beforeEach(() => {
    prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === 'function') return arg(prismaMock);
      return Promise.all(arg as Promise<unknown>[]);
    });
    prismaMock.user.update.mockResolvedValue({} as never);
    prismaMock.accountRecovery.update.mockResolvedValue({} as never);
    prismaMock.userSession.updateMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.badPassword.findFirst.mockResolvedValue(null);
  });

  it('throws 400 when token is invalid or expired', async () => {
    prismaMock.accountRecovery.findFirst.mockResolvedValue(null);
    await expect(
      resetPasswordWithToken('badtoken', 'newpass')
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'Invalid or expired recovery token'
    });
  });

  it('throws 400 when new password is banned', async () => {
    prismaMock.accountRecovery.findFirst.mockResolvedValue({
      id: 1,
      userId: 7,
      token: 'validtoken'
    } as never);
    prismaMock.badPassword.findFirst.mockResolvedValue({
      password: 'banned'
    } as never);
    await expect(
      resetPasswordWithToken('validtoken', 'banned')
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'Password is not allowed'
    });
  });

  it('updates password and marks token used and revokes sessions', async () => {
    prismaMock.accountRecovery.findFirst.mockResolvedValue({
      id: 1,
      userId: 7,
      token: 'validtoken'
    } as never);
    await resetPasswordWithToken('validtoken', 'newpassword');

    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7 },
        data: expect.objectContaining({ password: expect.any(String) })
      })
    );
    expect(prismaMock.accountRecovery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: { usedAt: expect.any(Date) }
      })
    );
    expect(prismaMock.userSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 7, revokedAt: null },
        data: { revokedAt: expect.any(Date) }
      })
    );
  });
});

// ─── user.getSnatchList ───────────────────────────────────────────────────────

describe('user.getSnatchList', () => {
  const makeGrant = (releaseId: number, grantId: number) => ({
    id: grantId,
    consumerId: 7,
    status: 'COMPLETED',
    createdAt: new Date(),
    contribution: {
      release: {
        id: releaseId,
        title: `Release ${releaseId}`,
        communityId: 1,
        artist: { name: 'Artist' }
      }
    }
  });

  it('returns empty array when no grants exist', async () => {
    prismaMock.downloadAccessGrant.findMany.mockResolvedValue([]);
    const result = await getSnatchList(7);
    expect(result).toEqual([]);
  });

  it('deduplicates grants by release id, keeping the first seen', async () => {
    prismaMock.downloadAccessGrant.findMany.mockResolvedValue([
      makeGrant(1, 10),
      makeGrant(1, 11),
      makeGrant(2, 12)
    ] as never);
    const result = await getSnatchList(7);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(10);
    expect(result[1].id).toBe(12);
  });

  it('caps the result at 100 items', async () => {
    const grants = Array.from({ length: 150 }, (_, i) =>
      makeGrant(i + 1, i + 100)
    );
    prismaMock.downloadAccessGrant.findMany.mockResolvedValue(grants as never);
    const result = await getSnatchList(7);
    expect(result).toHaveLength(100);
  });
});

// ─── user.warnUser ────────────────────────────────────────────────────────────

describe('user.warnUser', () => {
  const baseWarning = {
    id: 1,
    userId: 5,
    warnedById: 7,
    reason: 'Spam',
    expiresAt: null,
    createdAt: new Date()
  };

  beforeEach(() => {
    prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === 'function') return arg(prismaMock);
      return Promise.all(arg as Promise<unknown>[]);
    });
    prismaMock.userWarning.create.mockResolvedValue(baseWarning as never);
    prismaMock.user.update.mockResolvedValue({} as never);
    prismaMock.auditLog.create.mockResolvedValue({} as never);
  });

  it('throws 404 when user not found', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(warnUser(5, 7, 'reason')).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it('creates a warning and updates user warned counters', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 5 } as never);

    const result = await warnUser(5, 7, 'Spam');

    expect(prismaMock.userWarning.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 5,
          warnedById: 7,
          reason: 'Spam'
        })
      })
    );
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        data: expect.objectContaining({
          warnedTimes: { increment: 1 },
          warned: expect.any(Date)
        })
      })
    );
    expect(result.id).toBe(1);
  });

  it('includes expiresAt in warning when provided', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 5 } as never);
    const expiry = '2026-12-31T00:00:00.000Z';

    await warnUser(5, 7, 'Spam', expiry);

    expect(prismaMock.userWarning.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ expiresAt: new Date(expiry) })
      })
    );
  });
});

// ─── user.deleteWarning ───────────────────────────────────────────────────────

describe('user.deleteWarning', () => {
  beforeEach(() => {
    prismaMock.userWarning.delete.mockResolvedValue({} as never);
  });

  it('throws 404 when warning not found', async () => {
    prismaMock.userWarning.findUnique.mockResolvedValue(null);
    await expect(deleteWarning(5, 99)).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it('throws 404 when warning belongs to a different user', async () => {
    prismaMock.userWarning.findUnique.mockResolvedValue({
      id: 99,
      userId: 999
    } as never);
    await expect(deleteWarning(5, 99)).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it('clears the warned flag when no warnings remain', async () => {
    prismaMock.userWarning.findUnique.mockResolvedValue({
      id: 1,
      userId: 5
    } as never);
    prismaMock.userWarning.count.mockResolvedValue(0);
    prismaMock.user.update.mockResolvedValue({} as never);

    await deleteWarning(5, 1);

    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5 }, data: { warned: null } })
    );
  });

  it('does not clear the warned flag when warnings remain', async () => {
    prismaMock.userWarning.findUnique.mockResolvedValue({
      id: 1,
      userId: 5
    } as never);
    prismaMock.userWarning.count.mockResolvedValue(2);

    await deleteWarning(5, 1);

    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

// ─── user.setUserRank ─────────────────────────────────────────────────────────

describe('user.setUserRank', () => {
  beforeEach(() => {
    prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === 'function') return arg(prismaMock);
      return Promise.all(arg as Promise<unknown>[]);
    });
    prismaMock.user.update.mockResolvedValue({} as never);
    prismaMock.userSecondaryRank.deleteMany.mockResolvedValue({
      count: 0
    } as never);
    prismaMock.auditLog.create.mockResolvedValue({} as never);
  });

  it('throws 404 when user not found', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(setUserRank(5, 1, [], 7)).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it('throws 404 when primary rank not found', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 5 } as never);
    prismaMock.userRank.findMany.mockResolvedValue([]);
    await expect(setUserRank(5, 99, [], 7)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Rank not found'
    });
  });

  it('throws 422 when assigning a secondary rank as primary', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 5 } as never);
    prismaMock.userRank.findMany.mockResolvedValue([
      { id: 1, secondary: true }
    ] as never);
    await expect(setUserRank(5, 1, [], 7)).rejects.toMatchObject({
      statusCode: 422,
      message: 'Primary rank cannot be a secondary class'
    });
  });

  it('throws 422 when assigning a non-secondary rank as secondary', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 5 } as never);
    prismaMock.userRank.findMany.mockResolvedValue([
      { id: 1, secondary: false },
      { id: 2, secondary: false }
    ] as never);
    await expect(setUserRank(5, 1, [2], 7)).rejects.toMatchObject({
      statusCode: 422,
      message: 'Only secondary-class ranks can be assigned as secondary classes'
    });
  });

  it('applies rank update with no secondary ranks', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 5 } as never);
    prismaMock.userRank.findMany.mockResolvedValue([
      { id: 1, secondary: false }
    ] as never);

    await setUserRank(5, 1, [], 7);

    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5 }, data: { userRankId: 1 } })
    );
    expect(prismaMock.userSecondaryRank.deleteMany).toHaveBeenCalledWith({
      where: { userId: 5 }
    });
  });

  it('deduplicates secondary rank ids', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 5 } as never);
    prismaMock.userRank.findMany.mockResolvedValue([
      { id: 1, secondary: false },
      { id: 2, secondary: true }
    ] as never);
    prismaMock.userSecondaryRank.createMany.mockResolvedValue({
      count: 1
    } as never);

    await setUserRank(5, 1, [2, 2, 2], 7);

    expect(prismaMock.userSecondaryRank.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [{ userId: 5, userRankId: 2, assignedById: 7 }]
      })
    );
  });
});

// ─── user.grantDonorStatus ────────────────────────────────────────────────────

describe('user.grantDonorStatus', () => {
  beforeEach(() => {
    prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === 'function') return arg(prismaMock);
      return Promise.all(arg as Promise<unknown>[]);
    });
    prismaMock.userDonorRank.upsert.mockResolvedValue({} as never);
    prismaMock.user.update.mockResolvedValue({} as never);
    prismaMock.auditLog.create.mockResolvedValue({} as never);
  });

  it('throws 404 when user not found', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(grantDonorStatus(5, 1, null, 7)).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it('throws 404 when donor rank not found', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 5 } as never);
    prismaMock.donorRank.findUnique.mockResolvedValue(null);
    await expect(grantDonorStatus(5, 99, null, 7)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Donor rank not found'
    });
  });

  it('uses explicit expiresAt when provided', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 5 } as never);
    prismaMock.donorRank.findUnique.mockResolvedValue({
      id: 1,
      expiresAfterDays: 30
    } as never);

    await grantDonorStatus(5, 1, '2027-01-01T00:00:00.000Z', 7);

    expect(prismaMock.userDonorRank.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          expiresAt: new Date('2027-01-01T00:00:00.000Z')
        })
      })
    );
  });

  it('falls back to expiresAfterDays when no explicit expiresAt', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 5 } as never);
    prismaMock.donorRank.findUnique.mockResolvedValue({
      id: 1,
      expiresAfterDays: 7
    } as never);

    const before = Date.now();
    await grantDonorStatus(5, 1, null, 7);
    const after = Date.now();

    const upsertCall = prismaMock.userDonorRank.upsert.mock.calls[0][0];
    const expiresAt = upsertCall.create.expiresAt as Date;
    const expected = 7 * 86_400_000;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + expected - 100);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(after + expected + 100);
  });

  it('sets null expiresAt when rank has no expiry and no explicit date', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 5 } as never);
    prismaMock.donorRank.findUnique.mockResolvedValue({
      id: 1,
      expiresAfterDays: null
    } as never);

    await grantDonorStatus(5, 1, null, 7);

    expect(prismaMock.userDonorRank.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ expiresAt: null })
      })
    );
  });
});

// ─── user.getUserIpHistory ────────────────────────────────────────────────────

describe('user.getUserIpHistory', () => {
  const now = new Date('2026-05-01T12:00:00Z');
  const earlier = new Date('2026-04-01T10:00:00Z');

  it('returns empty array when no sessions exist', async () => {
    prismaMock.userSession.findMany.mockResolvedValue([]);
    const result = await getUserIpHistory(7);
    expect(result).toEqual([]);
  });

  it('deduplicates IPs, keeping only the first occurrence (most recent by query order)', async () => {
    prismaMock.userSession.findMany.mockResolvedValue([
      {
        ipAddress: '1.2.3.4',
        createdAt: now,
        lastActiveAt: null,
        id: 'a',
        userAgent: '',
        revokedAt: null
      },
      {
        ipAddress: '1.2.3.4',
        createdAt: earlier,
        lastActiveAt: null,
        id: 'b',
        userAgent: '',
        revokedAt: null
      },
      {
        ipAddress: '5.6.7.8',
        createdAt: now,
        lastActiveAt: null,
        id: 'c',
        userAgent: '',
        revokedAt: null
      }
    ] as never);

    const result = await getUserIpHistory(7);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.ip)).toEqual(['1.2.3.4', '5.6.7.8']);
  });

  it('prefers lastActiveAt over createdAt for seenAt', async () => {
    const lastActive = new Date('2026-05-10T09:00:00Z');
    prismaMock.userSession.findMany.mockResolvedValue([
      {
        ipAddress: '1.2.3.4',
        createdAt: now,
        lastActiveAt: lastActive,
        id: 'a',
        userAgent: '',
        revokedAt: null
      }
    ] as never);

    const result = await getUserIpHistory(7);

    expect(result[0].seenAt).toBe(lastActive.toISOString());
  });

  it('skips sessions with null ipAddress', async () => {
    prismaMock.userSession.findMany.mockResolvedValue([
      {
        ipAddress: null,
        createdAt: now,
        lastActiveAt: null,
        id: 'a',
        userAgent: '',
        revokedAt: null
      },
      {
        ipAddress: '1.2.3.4',
        createdAt: now,
        lastActiveAt: null,
        id: 'b',
        userAgent: '',
        revokedAt: null
      }
    ] as never);

    const result = await getUserIpHistory(7);
    expect(result).toHaveLength(1);
    expect(result[0].ip).toBe('1.2.3.4');
  });
});

// ─── user.updateStaffBio ─────────────────────────────────────────────────────

describe('user.updateStaffBio', () => {
  beforeEach(() => {
    prismaMock.user.update.mockResolvedValue({} as never);
    prismaMock.auditLog.create.mockResolvedValue({} as never);
  });

  it('throws 403 when non-admin actor rank lacks displayStaff', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue({
      displayStaff: false
    } as never);
    await expect(updateStaffBio(5, 'bio', 7, 2, false)).rejects.toMatchObject({
      statusCode: 403
    });
  });

  it('throws 404 when target user not found', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue({
      displayStaff: true
    } as never);
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(updateStaffBio(5, 'bio', 7, 2, false)).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it('skips displayStaff check for admins', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 5 } as never);

    await updateStaffBio(5, 'bio', 7, 2, true);

    expect(prismaMock.userRank.findUnique).not.toHaveBeenCalled();
  });

  it('normalizes empty string bio to null', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 5 } as never);

    await updateStaffBio(5, '   ', 7, 2, true);

    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { staffBio: null } })
    );
  });

  it('trims whitespace from bio', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 5 } as never);

    await updateStaffBio(5, '  hello world  ', 7, 2, true);

    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { staffBio: 'hello world' } })
    );
  });
});

// ─── user.getInviteTree ───────────────────────────────────────────────────────

describe('user.getInviteTree', () => {
  it('returns total count separately from rows', async () => {
    prismaMock.inviteTree.findMany.mockResolvedValue([]);
    prismaMock.inviteTree.count.mockResolvedValue(5);

    const result = await getInviteTree({ skip: 0, limit: 20 });
    expect(result.total).toBe(5);
    expect(result.rows).toEqual([]);
  });

  it('returns the included user + inviter relations on each row', async () => {
    prismaMock.inviteTree.findMany.mockResolvedValue([
      {
        id: 1,
        userId: 10,
        inviterId: 7,
        user: { id: 10, username: 'child' },
        inviter: { id: 7, username: 'parent' }
      }
    ] as never);
    prismaMock.inviteTree.count.mockResolvedValue(1);

    const result = await getInviteTree({ skip: 0, limit: 20 });
    expect(result.rows[0].inviter).toEqual({ id: 7, username: 'parent' });
    expect(result.rows[0].user).toEqual({ id: 10, username: 'child' });
  });

  it('inviter is null for a tree root (no inviter)', async () => {
    prismaMock.inviteTree.findMany.mockResolvedValue([
      {
        id: 1,
        userId: 10,
        inviterId: null,
        user: { id: 10, username: 'root' },
        inviter: null
      }
    ] as never);
    prismaMock.inviteTree.count.mockResolvedValue(1);

    const result = await getInviteTree({ skip: 0, limit: 20 });
    expect(result.rows[0].inviter).toBeNull();
  });
});

// ─── user.getDuplicateIps ─────────────────────────────────────────────────────

describe('user.getDuplicateIps', () => {
  it('returns empty array when no duplicate IPs exist', async () => {
    (prismaMock.user.groupBy as jest.Mock).mockResolvedValue([]);
    const result = await getDuplicateIps();
    expect(result).toEqual([]);
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  it('fetches users for each duplicate IP', async () => {
    (prismaMock.user.groupBy as jest.Mock).mockResolvedValue([
      { lastIp: '1.2.3.4', _count: { lastIp: 2 } }
    ]);
    prismaMock.user.findMany.mockResolvedValue([
      {
        id: 1,
        username: 'alice',
        dateRegistered: new Date(),
        disabled: false,
        lastLogin: null
      },
      {
        id: 2,
        username: 'bob',
        dateRegistered: new Date(),
        disabled: false,
        lastLogin: null
      }
    ] as never);

    const result = await getDuplicateIps();
    expect(result).toHaveLength(1);
    expect(result[0].ip).toBe('1.2.3.4');
    expect(result[0].count).toBe(2);
    expect(result[0].users).toHaveLength(2);
  });
});
