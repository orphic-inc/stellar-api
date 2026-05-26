import { prisma } from '../lib/prisma';
import { sanitizePlain } from '../lib/sanitize';
import { AppError } from '../lib/errors';

export type PerksMap = {
  iconMouseOverText?: boolean;
  avatarMouseOverText?: boolean;
  customIconLink?: boolean;
  customIcon?: boolean;
  forumTitle?: boolean;
  secondAvatar?: boolean;
  profileInfo1?: boolean;
  profileInfo2?: boolean;
  profileInfo3?: boolean;
  profileInfo4?: boolean;
};

export type DonorRewardFields = {
  iconMouseOverText: string;
  avatarMouseOverText: string;
  customIcon: string;
  customIconLink: string;
  secondAvatar: string;
  profileInfo1: string;
  profileInfoTitle1: string;
  profileInfo2: string;
  profileInfoTitle2: string;
  profileInfo3: string;
  profileInfoTitle3: string;
  profileInfo4: string;
  profileInfoTitle4: string;
};

export type DonorForumTitle = {
  prefix: string;
  suffix: string;
  useComma: boolean;
};

export type DonorSettings = {
  rewards: DonorRewardFields;
  perks: PerksMap;
  forumTitle: DonorForumTitle | null;
};

// Maps each reward field to the perk key that unlocks it.
// Title fields (profileInfoTitle*) share the same perk as their paired body field.
const FIELD_PERK_MAP: Record<keyof DonorRewardFields, keyof PerksMap> = {
  iconMouseOverText: 'iconMouseOverText',
  avatarMouseOverText: 'avatarMouseOverText',
  customIcon: 'customIcon',
  customIconLink: 'customIconLink',
  secondAvatar: 'secondAvatar',
  profileInfo1: 'profileInfo1',
  profileInfoTitle1: 'profileInfo1',
  profileInfo2: 'profileInfo2',
  profileInfoTitle2: 'profileInfo2',
  profileInfo3: 'profileInfo3',
  profileInfoTitle3: 'profileInfo3',
  profileInfo4: 'profileInfo4',
  profileInfoTitle4: 'profileInfo4'
};

export const parsePerks = (raw: unknown): PerksMap => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as PerksMap;
  }
  return {};
};

const REWARD_DEFAULTS: DonorRewardFields = {
  iconMouseOverText: '',
  avatarMouseOverText: '',
  customIcon: '',
  customIconLink: '',
  secondAvatar: '',
  profileInfo1: '',
  profileInfoTitle1: '',
  profileInfo2: '',
  profileInfoTitle2: '',
  profileInfo3: '',
  profileInfoTitle3: '',
  profileInfo4: '',
  profileInfoTitle4: ''
};

// Returns the user's active (non-expired) donor rank row, or null.
// Using findFirst because UserDonorRank is unique on userId but we need the
// expiry filter, which requires a WHERE clause Prisma only supports on findFirst.
const getActiveRankRow = async (userId: number) => {
  const now = new Date();
  return prisma.userDonorRank.findFirst({
    where: {
      userId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
    },
    select: {
      donorRank: { select: { perks: true } }
    }
  });
};

export const getDonorSettings = async (
  userId: number
): Promise<DonorSettings | null> => {
  const activeRank = await getActiveRankRow(userId);
  if (!activeRank) return null;

  const perks = parsePerks(activeRank.donorRank.perks);

  const [rewardRow, titleRow] = await Promise.all([
    prisma.donorReward.findUnique({ where: { userId } }),
    perks.forumTitle
      ? prisma.donorForumUsername.findUnique({ where: { userId } })
      : Promise.resolve(null)
  ]);

  const rewards: DonorRewardFields = {
    ...REWARD_DEFAULTS,
    ...(rewardRow ?? {})
  };

  const forumTitle =
    perks.forumTitle && titleRow
      ? {
          prefix: titleRow.prefix,
          suffix: titleRow.suffix,
          useComma: titleRow.useComma
        }
      : null;

  return { rewards, perks, forumTitle };
};

export const updateDonorRewards = async (
  userId: number,
  fields: Partial<DonorRewardFields>
): Promise<DonorSettings> => {
  const activeRank = await getActiveRankRow(userId);
  if (!activeRank) throw new AppError(403, 'No active donor rank');

  const perks = parsePerks(activeRank.donorRank.perks);

  // Only write fields whose perk is enabled
  const allowed: Partial<Record<string, string>> = {};
  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const perkKey = FIELD_PERK_MAP[field as keyof DonorRewardFields];
    if (perkKey && perks[perkKey]) {
      allowed[field] = sanitizePlain(value as string);
    }
  }

  if (Object.keys(allowed).length > 0) {
    await prisma.donorReward.upsert({
      where: { userId },
      create: { userId, ...allowed },
      update: allowed
    });
  }

  const settings = await getDonorSettings(userId);
  return settings!;
};

export const updateDonorForumTitle = async (
  userId: number,
  data: { prefix?: string; suffix?: string; useComma?: boolean }
): Promise<DonorForumTitle> => {
  const activeRank = await getActiveRankRow(userId);
  if (!activeRank) throw new AppError(403, 'No active donor rank');

  const perks = parsePerks(activeRank.donorRank.perks);
  if (!perks.forumTitle)
    throw new AppError(403, 'Forum title perk not enabled');

  const sanitized = {
    ...(data.prefix !== undefined && {
      prefix: sanitizePlain(data.prefix).trim()
    }),
    ...(data.suffix !== undefined && {
      suffix: sanitizePlain(data.suffix).trim()
    }),
    ...(data.useComma !== undefined && { useComma: data.useComma })
  };

  const updated = await prisma.donorForumUsername.upsert({
    where: { userId },
    create: { userId, prefix: '', suffix: '', useComma: true, ...sanitized },
    update: sanitized
  });

  return {
    prefix: updated.prefix,
    suffix: updated.suffix,
    useComma: updated.useComma
  };
};
