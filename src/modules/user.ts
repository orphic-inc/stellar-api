import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { audit } from '../lib/audit';

export const getUserSettings = async (userId: number) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { userSettingsId: true }
  });
  if (!user) return null;
  return prisma.userSettings.findUnique({ where: { id: user.userSettingsId } });
};

export const updateUserSettings = async (
  userId: number,
  data: {
    siteAppearance?: string;
    externalStylesheet?: string;
    styledTooltips?: boolean;
    paranoia?: number;
    avatar?: string;
  }
) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { userSettingsId: true }
  });
  if (!user) return null;

  const [settings] = await prisma.$transaction([
    prisma.userSettings.update({
      where: { id: user.userSettingsId },
      data: {
        ...(data.siteAppearance !== undefined && {
          siteAppearance: data.siteAppearance
        }),
        ...(data.externalStylesheet !== undefined && {
          externalStylesheet: data.externalStylesheet
        }),
        ...(data.styledTooltips !== undefined && {
          styledTooltips: data.styledTooltips
        }),
        ...(data.paranoia !== undefined && { paranoia: data.paranoia })
      }
    }),
    ...(data.avatar !== undefined
      ? [
          prisma.user.update({
            where: { id: userId },
            data: { avatar: data.avatar }
          })
        ]
      : [])
  ]);
  return { ...settings, avatar: data.avatar };
};

export const createUser = async (
  data: {
    username: string;
    email: string;
    password: string;
    userRankId?: number;
  },
  actorId: number
) => {
  const rankId =
    data.userRankId ??
    (await prisma.userRank.findFirst({ where: { level: 100 } }))?.id;
  if (!rankId) throw new Error('Default rank not found');

  const hashedPassword = await bcrypt.hash(
    data.password,
    await bcrypt.genSalt(10)
  );

  const user = await prisma.$transaction(async (tx) => {
    const settings = await tx.userSettings.create({ data: {} });
    const profile = await tx.profile.create({ data: {} });
    return tx.user.create({
      data: {
        username: data.username,
        email: data.email.toLowerCase(),
        password: hashedPassword,
        avatar: '',
        userRankId: rankId,
        userSettingsId: settings.id,
        profileId: profile.id
      },
      select: { id: true, username: true, email: true }
    });
  });

  await audit(prisma, actorId, 'user.create', 'User', user.id, {
    username: data.username,
    email: data.email
  });

  return user;
};
