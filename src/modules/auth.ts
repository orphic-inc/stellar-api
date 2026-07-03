import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { computeRatio } from './ratio';
import { computeUserRankAccess } from '../lib/userRankAccess';
import { getDefaultStylesheetName } from './stylesheet';

export const isPasswordBanned = async (password: string): Promise<boolean> => {
  const found = await prisma.badPassword.findFirst({ where: { password } });
  return !!found;
};

export const authUserSelect = {
  id: true,
  username: true,
  email: true,
  avatar: true,
  isArtist: true,
  isDonor: true,
  canDownload: true,
  inviteCount: true,
  dateRegistered: true,
  lastLogin: true,
  contributed: true,
  consumed: true,
  ratio: true,
  userRank: {
    select: {
      id: true,
      level: true,
      name: true,
      color: true,
      badge: true,
      permissions: true,
      personalCollageLimit: true,
      authorStylesheetLimit: true
    }
  },
  secondaryRanks: {
    select: {
      userRankId: true,
      userRank: {
        select: {
          id: true,
          level: true,
          permissions: true,
          permittedForumIds: true,
          personalCollageLimit: true,
          authorStylesheetLimit: true
        }
      }
    }
  }
} as const;

type RawAuthUser = Prisma.UserGetPayload<{ select: typeof authUserSelect }>;

export type AuthUser = Omit<RawAuthUser, 'contributed' | 'consumed'> & {
  contributed: string;
  consumed: string;
};

export const toAuthUser = (raw: RawAuthUser): AuthUser => ({
  ...raw,
  userRank: {
    ...raw.userRank,
    permissions: computeUserRankAccess({
      userRankId: raw.userRank.id,
      userRank: {
        id: raw.userRank.id,
        level: raw.userRank.level,
        permissions: raw.userRank.permissions,
        permittedForumIds: []
      },
      secondaryRanks: raw.secondaryRanks.map((entry) => ({
        userRankId: entry.userRankId,
        userRank: {
          id: entry.userRank.id,
          level: entry.userRank.level,
          permissions: entry.userRank.permissions,
          permittedForumIds: entry.userRank.permittedForumIds
        }
      }))
    }).permissions,
    personalCollageLimit: Math.max(
      raw.userRank.personalCollageLimit ?? 0,
      ...raw.secondaryRanks.map(
        (entry) => entry.userRank.personalCollageLimit ?? 0
      )
    ),
    authorStylesheetLimit: Math.max(
      raw.userRank.authorStylesheetLimit ?? 0,
      ...raw.secondaryRanks.map(
        (entry) => entry.userRank.authorStylesheetLimit ?? 0
      )
    )
  },
  ratio: computeRatio(raw.contributed, raw.consumed),
  contributed: raw.contributed.toString(),
  consumed: raw.consumed.toString()
});

type RegisterResult =
  | {
      ok: false;
      reason:
        | 'user_exists'
        | 'bad_password'
        | 'registration_closed'
        | 'invite_required'
        | 'invalid_invite'
        | 'invite_email_mismatch';
    }
  | { ok: true; user: AuthUser };

export type RegisterOptions = {
  username: string;
  email: string;
  password: string;
  /** Passed from getSettings().registrationStatus — the module does not read settings itself. */
  registrationMode: 'open' | 'invite' | 'closed';
  inviteKey?: string;
};

type LoginResult =
  | { ok: false; reason: 'not_found' | 'disabled' | 'wrong_password' }
  | { ok: true; user: AuthUser };

export const registerUser = async ({
  username,
  email,
  password,
  registrationMode,
  inviteKey
}: RegisterOptions): Promise<RegisterResult> => {
  // 1. Mode gate — no DB required
  if (registrationMode === 'closed') {
    return { ok: false, reason: 'registration_closed' };
  }

  if (registrationMode === 'invite') {
    if (!inviteKey) return { ok: false, reason: 'invite_required' };
    // Pre-validate for an early exit before any writes. The actual
    // consumption (status → accepted) happens inside the user-creation
    // transaction below, making the two operations atomic.
    const invite = await prisma.invite.findUnique({ where: { inviteKey } });
    if (!invite || invite.status !== 'pending') {
      return { ok: false, reason: 'invalid_invite' };
    }
    if (invite.email.toLowerCase() !== email.toLowerCase()) {
      return { ok: false, reason: 'invite_email_mismatch' };
    }
  }

  // 2. Uniqueness / quality checks
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: email.toLowerCase() }, { username }] }
  });
  if (existing) return { ok: false, reason: 'user_exists' };

  if (await isPasswordBanned(password)) {
    return { ok: false, reason: 'bad_password' };
  }

  const defaultRank = await prisma.userRank.findFirst({
    where: { level: 100 }
  });
  if (!defaultRank)
    throw new AppError(
      503,
      'Server misconfigured: default rank missing. Run setup.'
    );

  const hashedPassword = await bcrypt.hash(password, await bcrypt.genSalt(10));

  // 3. Atomic: create user + consume invite in one transaction so a crash
  //    between the two can never leave the invite permanently open.
  const user = await prisma.$transaction(async (tx) => {
    const defaultTheme = await getDefaultStylesheetName(tx);
    const settings = await tx.userSettings.create({
      data: { siteAppearance: defaultTheme }
    });
    const profile = await tx.profile.create({ data: {} });
    const newUser = await tx.user.create({
      data: {
        username,
        email: email.toLowerCase(),
        password: hashedPassword,
        // avatar left null — UI falls back to the bundled default avatar.
        // Gravatar was removed to avoid leaking email hashes (private site).
        userRankId: defaultRank.id,
        userSettingsId: settings.id,
        profileId: profile.id,
        contributed: 5_368_709_120n
      },
      select: authUserSelect
    });

    if (registrationMode === 'invite' && inviteKey) {
      await tx.invite.update({
        where: { inviteKey },
        data: { status: 'accepted' }
      });
    }

    return newUser;
  });

  return { ok: true, user: toAuthUser(user) };
};

export const changePassword = async (
  userId: number,
  currentPassword: string,
  newPassword: string
): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, password: true }
  });
  if (!user) throw new AppError(401, 'Unauthorized');

  const isMatch = await bcrypt.compare(currentPassword, user.password);
  if (!isMatch) throw new AppError(400, 'Current password is incorrect');

  if (await isPasswordBanned(newPassword)) {
    throw new AppError(400, 'Password is not allowed');
  }

  const hashed = await bcrypt.hash(newPassword, await bcrypt.genSalt(10));
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { password: hashed }
    }),
    prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() }
    })
  ]);
};

export const changeEmail = async (
  userId: number,
  newEmail: string,
  password: string,
  ipAddress: string
): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, password: true }
  });
  if (!user) throw new AppError(401, 'Unauthorized');

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) throw new AppError(400, 'Password is incorrect');

  const taken = await prisma.user.findUnique({
    where: { email: newEmail.toLowerCase() }
  });
  if (taken) throw new AppError(400, 'Email already in use');

  await prisma.$transaction([
    prisma.userEmailHistory.create({
      data: {
        userId,
        oldEmail: user.email,
        newEmail: newEmail.toLowerCase(),
        ipAddress
      }
    }),
    prisma.user.update({
      where: { id: userId },
      data: { email: newEmail.toLowerCase() }
    })
  ]);
};

export const generateRecoveryToken = (): string =>
  crypto.randomBytes(32).toString('hex');

// Persists a recovery token for userId: expires any pending tokens first, then
// inserts a fresh record valid for 2 hours. Call only after email delivery
// succeeds to avoid orphaned rows when SMTP is unconfigured.
export const persistRecoveryToken = async (
  userId: number,
  token: string
): Promise<void> => {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  await prisma.$transaction([
    prisma.accountRecovery.updateMany({
      where: { userId, usedAt: null, expiresAt: { gt: now } },
      data: { expiresAt: now }
    }),
    prisma.accountRecovery.create({
      data: { userId, token, expiresAt }
    })
  ]);
};

export const resetPasswordWithToken = async (
  token: string,
  newPassword: string
): Promise<void> => {
  const recovery = await prisma.accountRecovery.findFirst({
    where: { token, usedAt: null, expiresAt: { gt: new Date() } }
  });
  if (!recovery) throw new AppError(400, 'Invalid or expired recovery token');

  if (await isPasswordBanned(newPassword)) {
    throw new AppError(400, 'Password is not allowed');
  }

  const hashed = await bcrypt.hash(newPassword, await bcrypt.genSalt(10));
  await prisma.$transaction([
    prisma.user.update({
      where: { id: recovery.userId },
      data: { password: hashed }
    }),
    prisma.accountRecovery.update({
      where: { id: recovery.id },
      data: { usedAt: new Date() }
    }),
    prisma.userSession.updateMany({
      where: { userId: recovery.userId, revokedAt: null },
      data: { revokedAt: new Date() }
    })
  ]);
};

export const loginUser = async (
  email: string,
  password: string,
  ipAddress?: string
): Promise<LoginResult> => {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() }
  });
  if (!user) return { ok: false, reason: 'not_found' };
  if (user.disabled) return { ok: false, reason: 'disabled' };

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) return { ok: false, reason: 'wrong_password' };

  const authUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      lastLogin: new Date(),
      ...(ipAddress ? { lastIp: ipAddress } : {})
    },
    select: authUserSelect
  });

  return { ok: true, user: toAuthUser(authUser) };
};
