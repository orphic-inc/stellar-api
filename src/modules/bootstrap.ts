/**
 * Idempotent bootstrap helpers shared by prisma/seed.ts and the install route.
 * Each function is a no-op when the relevant rows already exist.
 *
 * Including rows a concurrent seed creates mid-run (#596). The boot seed runs
 * before the server listens, but two `POST /install` requests on a fresh site
 * run `seedAll` side by side, so each read-then-create here can lose a unique
 * key to the other. A P2002 means "already seeded", never an error.
 */
import {
  Prisma,
  PrismaClient,
  CommunityType,
  RegistrationStatus
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { ALL_PERMISSIONS } from '../lib/rankPermissions';
import {
  DEFAULT_RANKS as EVALUATOR_RANKS,
  DEFAULT_RULES
} from './rankProgression';
import { site } from './config';
import { FORUM_STRUCTURE, type ForumEntry } from './forumStructure';

export const DEFAULT_RANKS = [
  {
    level: 100,
    name: 'User',
    secondary: false,
    permittedForumIds: [],
    color: '',
    badge: '',
    personalCollageLimit: 1,
    // Asset upload scales up the ladder like personalCollageLimit but starts at
    // zero (#342): a brand-new User has no reason to upload a stylesheet asset,
    // so they upload nothing. 0 = none, null = unlimited (staff).
    assetLimit: 0,
    // Contribution notification filters (#263, ADR-0049) start closed on every
    // member rank: staff opt a class in from the rank editor. Staff hold null.
    notificationFilterLimit: 0,
    permissions: {
      forums_read: true,
      forums_post: true,
      collages_create: true,
      requests_create: true,
      wiki_edit: true
    }
  },
  {
    level: 150,
    name: 'Member',
    secondary: false,
    permittedForumIds: [],
    color: '',
    badge: '',
    personalCollageLimit: 1,
    assetLimit: 1,
    notificationFilterLimit: 0,
    // One step past User: unlocks advanced discovery. Identity stays understated
    // (no color/badge) — the first earned rung, not yet a "notable" tier.
    permissions: {
      forums_read: true,
      forums_post: true,
      advanced_search: true,
      collages_create: true,
      requests_create: true,
      wiki_edit: true
    }
  },
  {
    level: 200,
    name: 'Power User',
    secondary: false,
    permittedForumIds: [],
    color: '#e2a822',
    badge: '',
    personalCollageLimit: 2,
    assetLimit: 2,
    notificationFilterLimit: 0,
    permissions: {
      forums_read: true,
      forums_post: true,
      advanced_search: true,
      collages_create: true,
      collages_manage: true,
      requests_create: true,
      wiki_edit: true
    }
  },
  {
    level: 300,
    name: 'Elite',
    secondary: false,
    permittedForumIds: [],
    color: '#3a9bd9',
    badge: '',
    personalCollageLimit: 3,
    assetLimit: 3,
    notificationFilterLimit: 0,
    // Top of the "earns new powers" range: adds elevated user search and collage
    // management. The auto ladder above Elite is prestige — identity, not new perms.
    permissions: {
      forums_read: true,
      forums_post: true,
      advanced_search: true,
      users_search: true,
      collages_create: true,
      collages_manage: true,
      requests_create: true,
      wiki_edit: true
    }
  },
  // Prestige tiers (USER_CLASSES_PLAN §11, names confirmed): no member-level
  // permissions remain to grant below staff, so these differentiate on identity
  // (color/badge) and personal-collage headroom rather than new capability.
  {
    level: 350,
    name: 'Stellarific',
    secondary: false,
    permittedForumIds: [],
    color: '#9b59d0',
    badge: '',
    personalCollageLimit: 4,
    assetLimit: 4,
    notificationFilterLimit: 0,
    permissions: {
      forums_read: true,
      forums_post: true,
      advanced_search: true,
      users_search: true,
      collages_create: true,
      collages_manage: true,
      requests_create: true,
      wiki_edit: true
    }
  },
  {
    level: 400,
    name: 'Stellartastic',
    secondary: false,
    permittedForumIds: [],
    color: '#c061e8',
    badge: '',
    personalCollageLimit: 5,
    assetLimit: 5,
    notificationFilterLimit: 0,
    permissions: {
      forums_read: true,
      forums_post: true,
      advanced_search: true,
      users_search: true,
      collages_create: true,
      collages_manage: true,
      requests_create: true,
      wiki_edit: true
    }
  },
  {
    level: 450,
    name: 'Stellarige',
    secondary: false,
    permittedForumIds: [],
    color: '#d4a5ff',
    badge: '',
    personalCollageLimit: 6,
    assetLimit: 6,
    notificationFilterLimit: 0,
    permissions: {
      forums_read: true,
      forums_post: true,
      advanced_search: true,
      users_search: true,
      collages_create: true,
      collages_manage: true,
      requests_create: true,
      wiki_edit: true
    }
  },
  {
    level: 500,
    name: 'Staff',
    secondary: false,
    permittedForumIds: [],
    color: '#e22a2a',
    badge: '',
    personalCollageLimit: 3,
    // Staff and SysOp are uncapped (null): they curate site fixtures and have no
    // reason to hit an upload ceiling. Diverges from personalCollageLimit, which
    // gives staff a concrete number — assets are the resource we want unlimited.
    assetLimit: null,
    notificationFilterLimit: null,
    permissions: {
      forums_read: true,
      forums_post: true,
      forums_moderate: true,
      forums_manage: true,
      communities_manage: true,
      contributions_manage: true,
      collages_create: true,
      collages_manage: true,
      collages_moderate: true,
      news_manage: true,
      requests_create: true,
      requests_moderate: true,
      reports_manage: true,
      staff_inbox_manage: true,
      tags_manage: true,
      invites_manage: true,
      invites_edit: true,
      recovery_manage: true,
      users_edit: true,
      users_warn: true,
      users_disable: true,
      users_edit_reset_feeds: true,
      users_view_ips: true,
      users_view_email: true,
      messages_mass_pm: true,
      staff: true
    }
  },
  {
    level: 1000,
    name: 'SysOp',
    secondary: false,
    permittedForumIds: [],
    color: '#a0d468',
    badge: '',
    personalCollageLimit: 4,
    assetLimit: null,
    notificationFilterLimit: null,
    permissions: ALL_PERMISSIONS
  }
] as const;

export async function seedRanks(client: PrismaClient): Promise<void> {
  for (const rank of DEFAULT_RANKS) {
    const existing = await client.userRank.findUnique({
      where: { level: rank.level }
    });

    if (!existing) {
      try {
        await client.userRank.create({
          data: {
            ...rank,
            permittedForumIds: [...rank.permittedForumIds]
          }
        });
      } catch (err) {
        if (!hasPrismaCode(err, 'P2002')) throw err;
      }
      continue;
    }

    if (existing.name !== rank.name) continue;

    await client.userRank.update({
      where: { id: existing.id },
      data: {
        name: rank.name,
        secondary: rank.secondary,
        permittedForumIds: [...rank.permittedForumIds],
        color: rank.color,
        badge: rank.badge,
        personalCollageLimit: rank.personalCollageLimit,
        assetLimit: rank.assetLimit,
        notificationFilterLimit: rank.notificationFilterLimit,
        permissions: rank.permissions
      }
    });
  }
}

// The evaluator (rankProgression.ts) encodes the ladder against fixture rank ids
// 1–9; the DB assigns real autoincrement ids. Map fixture id → ladder level so the
// seeded rules are exactly DEFAULT_RULES, projected onto whatever ids the DB gave
// each level — one source of truth for the thresholds, no duplicated magnitudes.
const hasPrismaCode = (err: unknown, code: string) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;

const evaluatorLevelOf = (fixtureRankId: number): number => {
  const rank = EVALUATOR_RANKS.find((r) => r.id === fixtureRankId);
  if (!rank)
    throw new Error(
      `rankProgression DEFAULT_RANKS has no rank id ${fixtureRankId}`
    );
  return rank.level;
};

/**
 * Seed the promotion-rule ladder (USER_CLASSES_PLAN §5). Create-if-absent: once a
 * rule exists, re-seeding leaves it alone so runtime tuning via the admin editor
 * (#170) stays authoritative. A rung whose from/to rank isn't seeded yet is
 * skipped rather than failing the bootstrap.
 */
export async function seedRankPromotionRules(
  client: PrismaClient
): Promise<void> {
  const ranks = await client.userRank.findMany({
    select: { id: true, level: true }
  });
  const idByLevel = new Map(ranks.map((r) => [r.level, r.id]));

  for (const rule of DEFAULT_RULES) {
    const fromRankId = idByLevel.get(evaluatorLevelOf(rule.fromRankId));
    const toRankId = idByLevel.get(evaluatorLevelOf(rule.toRankId));
    if (fromRankId === undefined || toRankId === undefined) continue;

    // Prisma sends this upsert as a read then an insert, not ON CONFLICT.
    try {
      await client.rankPromotionRule.upsert({
        where: { fromRankId_toRankId: { fromRankId, toRankId } },
        update: {},
        create: {
          fromRankId,
          toRankId,
          minContributed: rule.minContributed,
          minRatio: rule.minRatio,
          minContributions: rule.minContributions,
          minAccountAgeDays: rule.minAccountAgeDays,
          extra: rule.extra,
          enabled: rule.enabled
        }
      });
    } catch (err) {
      if (!hasPrismaCode(err, 'P2002')) throw err;
    }
  }
}

export async function seedForums(client: PrismaClient): Promise<void> {
  const existing = await client.forumCategory.count();
  if (existing > 0) return;
  for (const cat of FORUM_STRUCTURE) {
    const category = await client.forumCategory.create({
      data: { name: cat.name, sort: cat.sort }
    });
    for (const f of cat.forums as readonly ForumEntry[]) {
      await client.forum.create({
        data: {
          forumCategoryId: category.id,
          sort: f.sort,
          name: f.name,
          description: f.description,
          minClassRead: f.minClassRead ?? 0,
          minClassWrite: f.minClassWrite ?? 0,
          minClassCreate: f.minClassCreate ?? 0,
          isTrash: f.isTrash ?? false
        }
      });
    }
  }
}

/** Reserved username for the non-interactive System account. */
export const SYSTEM_USERNAME = 'system';

/**
 * Seed the reserved, non-interactive System user that owns built-in content
 * fixtures (the built-in stylesheet `AuthorStylesheet` rows). It can never log in
 * — `disabled` + `rankLocked`, with an unguessable random password nobody holds —
 * and uses an RFC-reserved `.invalid` email so it can't collide with a real
 * signup. Idempotent on the unique username. Requires `seedRanks` to have run (it
 * takes the base User rank). Returns the id so dependent seeders can author under
 * it.
 */
export async function seedSystemUser(client: PrismaClient): Promise<number> {
  const existing = await client.user.findUnique({
    where: { username: SYSTEM_USERNAME },
    select: { id: true }
  });
  if (existing) return existing.id;

  const baseRank = await client.userRank.findFirst({ where: { level: 100 } });
  if (!baseRank)
    throw new Error(
      'base User rank missing — run seedRanks before seedSystemUser'
    );

  // Unusable password: a random 32-byte secret hashed and discarded. No plaintext
  // exists, so the account cannot authenticate even setting aside the disabled flag.
  const unusablePassword = await bcrypt.hash(
    randomBytes(32).toString('hex'),
    await bcrypt.genSalt(10)
  );

  return createSystemUser(client, baseRank.id, unusablePassword);
}

/**
 * The System user's rows, created together so a concurrent seed that wins the
 * username (#596) leaves nothing behind: its id is read back and returned.
 */
const createSystemUser = async (
  client: PrismaClient,
  userRankId: number,
  password: string
): Promise<number> => {
  try {
    const user = await client.$transaction(async (tx) => {
      const userSettings = await tx.userSettings.create({ data: {} });
      const profile = await tx.profile.create({ data: {} });
      return tx.user.create({
        data: {
          username: SYSTEM_USERNAME,
          email: 'system@stellar.invalid',
          password,
          userRankId,
          userSettingsId: userSettings.id,
          profileId: profile.id,
          disabled: true,
          rankLocked: true,
          // Every account has a row, the System user included (#633, ADR-0042).
          inviteTree: { create: { inviterId: null } }
        },
        select: { id: true }
      });
    });
    return user.id;
  } catch (err) {
    if (!hasPrismaCode(err, 'P2002')) throw err;
    const winner = await client.user.findUniqueOrThrow({
      where: { username: SYSTEM_USERNAME },
      select: { id: true }
    });
    return winner.id;
  }
};

/**
 * Seed the flagship public community named after the site, led by the first
 * SysOp. Runs from the install flow (needs the SysOp user), not prisma/seed.ts.
 * Leadership follows POST /api/communities (ADR-0021): the leader is a superset
 * of staff, so the SysOp is set as leaderId, folded into staff, and upserted as
 * a Consumer. Idempotent — skipped once a community with the site name exists.
 */
export async function seedDefaultCommunity(
  client: PrismaClient,
  ownerUserId: number
): Promise<void> {
  const existing = await client.community.findFirst({
    where: { name: site.name },
    select: { id: true }
  });
  if (existing) return;

  // The SysOp becomes leader and curator, and nothing more: no Consumer is
  // written (ADR-0033 §Decision 3). Belonging is the role union, not a claim
  // that whoever installed the site downloads from it.
  try {
    await client.community.create({
      data: {
        name: site.name,
        description: `The official ${site.name} community.`,
        type: CommunityType.Music,
        registrationStatus: RegistrationStatus.open,
        image: '/images/defaults/music.png',
        leader: { connect: { id: ownerUserId } },
        curators: { connect: { id: ownerUserId } }
      }
    });
  } catch (err) {
    // A concurrent install created it first (#596).
    if (!hasPrismaCode(err, 'P2002')) throw err;
  }
}
