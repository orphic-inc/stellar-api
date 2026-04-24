import bcrypt from 'bcryptjs';
import gravatar from 'gravatar';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

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
  userRank: {
    select: {
      level: true,
      name: true,
      color: true,
      badge: true,
      permissions: true
    }
  }
} as const;

type AuthUser = Prisma.UserGetPayload<{ select: typeof authUserSelect }>;

type RegisterResult =
  | { ok: false; reason: 'user_exists' }
  | { ok: true; user: AuthUser };

type LoginResult =
  | { ok: false; reason: 'not_found' | 'disabled' | 'wrong_password' }
  | { ok: true; user: AuthUser };

export const registerUser = async (
  username: string,
  email: string,
  password: string
): Promise<RegisterResult> => {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: email.toLowerCase() }, { username }] }
  });
  if (existing) return { ok: false, reason: 'user_exists' };

  const defaultRank = await prisma.userRank.findFirst({
    where: { level: 100 }
  });
  if (!defaultRank) throw new Error('Default rank not found');

  const avatar = gravatar.url(email, { s: '200', r: 'pg', d: 'mm' });
  const hashedPassword = await bcrypt.hash(password, await bcrypt.genSalt(10));

  const user = await prisma.$transaction(async (tx) => {
    const settings = await tx.userSettings.create({ data: {} });
    const profile = await tx.profile.create({ data: {} });
    return tx.user.create({
      data: {
        username,
        email: email.toLowerCase(),
        password: hashedPassword,
        avatar,
        userRankId: defaultRank.id,
        userSettingsId: settings.id,
        profileId: profile.id
      },
      select: authUserSelect
    });
  });

  return { ok: true, user };
};

export const loginUser = async (
  email: string,
  password: string
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
    data: { lastLogin: new Date() },
    select: authUserSelect
  });

  return { ok: true, user: authUser };
};
