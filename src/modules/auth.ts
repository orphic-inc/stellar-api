import bcrypt from 'bcryptjs';
import gravatar from 'gravatar';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { computeRatio } from './ratio';
import { computeUserRankAccess } from '../lib/userRankAccess';

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
      personalCollageLimit: true
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
          personalCollageLimit: true
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

  const avatar = gravatar.url(email, { s: '200', r: 'pg', d: 'mm' });
  const hashedPassword = await bcrypt.hash(password, await bcrypt.genSalt(10));

  // 3. Atomic: create user + consume invite in one transaction so a crash
  //    between the two can never leave the invite permanently open.
  const user = await prisma.$transaction(async (tx) => {
    const settings = await tx.userSettings.create({ data: {} });
    const profile = await tx.profile.create({ data: {} });
    const newUser = await tx.user.create({
      data: {
        username,
        email: email.toLowerCase(),
        password: hashedPassword,
        avatar,
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
