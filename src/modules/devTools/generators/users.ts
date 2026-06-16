/**
 * devTools/generators/users.ts
 *
 * Generates User rows with Profiles, UserSettings, secondary ranks,
 * warnings, and invite chains.
 *
 * Coverage:
 *   Models: User, Profile, UserSettings, UserWarning, UserSecondaryRank, Invite, InviteTree
 *   Edge cases: disabled users, warned users, ratio-watch, brand-new zero-activity users,
 *               power users, staff users, long bios, unicode-safe usernames
 */

import { randomBytes } from 'crypto';

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { RunContext } from '../types';
import {
  pick,
  randInt,
  randBool,
  randDate,
  weightedPick,
  daysAgo,
  SeedContext
} from '../seedRandom';
import {
  makeUsername,
  makeSeedEmail,
  makeBBCodeProfile,
  makeTransferBytes,
  makeAdminComment,
  makeWarnReason
} from '../contentFactory';
import { trackCreate, appendWarning } from '../tracking';

// Seed users carry the 'seeded' sentinel so generated test accounts are
// visually obvious. stellar-ui's avatarSrc() (src/utils/avatar.ts,
// SEEDED_AVATAR_SENTINEL) maps it to the distinct bundled seeded.png. This
// briefly stored null — back when no UI mapper/asset existed and the sentinel
// rendered as a broken <img src="seeded"> — but #59/#68 landed the mapper +
// seeded.png, so the value is restored. Keep it in sync with the UI sentinel.
const SEEDED_AVATAR: string | null = 'seeded';

// User archetype distribution
const ARCHETYPES = [
  'regular', // 60%
  'active', // 20%
  'power', // 10%
  'staff', //  5%
  'problem' //  5%
] as const;

type Archetype = (typeof ARCHETYPES)[number];

const ARCHETYPE_WEIGHTS = [60, 20, 10, 5, 5];

// Shared hashed password for all seed users — avoids expensive per-user hashing
let SEED_PASSWORD_HASH: string | null = null;

async function getSeedPasswordHash(): Promise<string> {
  if (!SEED_PASSWORD_HASH) {
    const salt = await bcrypt.genSalt(10);
    SEED_PASSWORD_HASH = await bcrypt.hash('SeedPassword1!', salt);
  }
  return SEED_PASSWORD_HASH!;
}

export async function generateUsers(
  prisma: PrismaClient,
  ctx: RunContext
): Promise<void> {
  const { config, runId } = ctx;
  const rng = new SeedContext(config.seed).fork('users');

  const targetCount = Math.max(
    3,
    Math.round(config.counts.users * config.scale)
  );

  // We need at least one admin-level rank to assign staff users
  const ranks = await prisma.userRank.findMany({
    orderBy: { level: 'asc' }
  });

  if (ranks.length === 0) {
    await appendWarning(
      prisma as Parameters<typeof appendWarning>[0],
      runId,
      'No UserRank rows found — all generated users will have userRankId = null. ' +
        'Run db:seed first.'
    );
    return;
  }

  const baseRank = ranks[0]; // lowest rank
  const adminRank = ranks[ranks.length - 1]; // highest rank (assumed staff/admin)
  const midRanks = ranks.slice(1, -1); // middle ranks for active/power users

  const passwordHash = await getSeedPasswordHash();
  const now = new Date();

  const createdUserIds: number[] = [];
  const staffUserIds: number[] = [];

  // Random 32-bit offset (0–4,294,967,295) keeps usernames unique across runs
  // even with the same seed and concurrent CI jobs.
  const runOffset = randomBytes(4).readUInt32BE(0);

  for (let i = 0; i < targetCount; i++) {
    const archetype = weightedPick<Archetype>(
      ARCHETYPES,
      ARCHETYPE_WEIGHTS,
      rng
    );
    const username = makeUsername(i + runOffset, rng);
    const email = makeSeedEmail(username);

    // Date registered: spread over last 3 years
    const dateRegistered = daysAgo(0, 3 * 365, rng);
    // lastLogin must be >= dateRegistered; active users bias toward last 30 days
    const activeWindowStart = new Date(
      Math.max(
        dateRegistered.getTime(),
        now.getTime() - 30 * 24 * 60 * 60 * 1000
      )
    );
    const lastLogin =
      archetype === 'problem' && randBool(0.4, rng)
        ? randDate(dateRegistered, now, rng)
        : randDate(activeWindowStart, now, rng);

    // Assign rank
    let userRankId: number;
    if (archetype === 'staff') {
      userRankId = adminRank.id;
    } else if (archetype === 'power' || archetype === 'active') {
      userRankId = midRanks.length > 0 ? pick(midRanks, rng).id : baseRank.id;
    } else {
      userRankId = baseRank.id;
    }

    // Transfer bytes
    let contributed: bigint;
    if (archetype === 'regular') {
      contributed = randBool(0.5, rng) ? 0n : makeTransferBytes(rng) / 10n;
    } else if (archetype === 'active') {
      contributed = makeTransferBytes(rng) / 5n;
    } else {
      contributed = makeTransferBytes(rng);
    }

    let consumed: bigint;
    if (archetype === 'regular') {
      consumed = makeTransferBytes(rng) / 20n;
    } else if (archetype === 'active') {
      consumed = makeTransferBytes(rng) / 10n;
    } else {
      consumed = makeTransferBytes(rng) / 5n;
    }

    const ratio =
      consumed === 0n ? 1.0 : Number(contributed) / Number(consumed);

    // Disability & warning state
    const warned = archetype === 'problem' && randBool(0.6, rng);
    const disabled = archetype === 'problem' && warned && randBool(0.4, rng);

    // Build profile bio
    const bio = makeBBCodeProfile(rng);

    // Staff bio
    const staffBio =
      archetype === 'staff' ? 'Seed-generated staff user.' : null;

    // Ratio watch — schema field is Int? (bytes as integer, capped at 2 GB)
    const ratioWatchDownload =
      archetype === 'problem' && !disabled && randBool(0.3, rng)
        ? Math.floor(Number(makeTransferBytes(rng)) / 1_000_000) // store as MB-scale int
        : null;

    // Create UserSettings
    const settings = await prisma.userSettings.create({
      data: {
        notificationMethod: pick(
          ['Disabled', 'Popup', 'Traditional', 'Push', 'Combined'] as const,
          rng
        ),
        showEmail: false,
        showLastSeen: randBool(0.7, rng),
        showContributedStats: randBool(0.8, rng),
        showConsumedStats: randBool(0.6, rng),
        showRatioStats: randBool(0.9, rng)
      }
    });

    // Create Profile
    const profile = await prisma.profile.create({
      data: {
        profileInfo: bio,
        profileTitle: randBool(0.2, rng)
          ? pick(
              ['Contributor', 'Power User', 'Lurker', 'Newbie', 'Veteran'],
              rng
            )
          : null
      }
    });

    // Create User
    const user = await prisma.user.create({
      data: {
        username,
        email,
        password: passwordHash,
        avatar: SEEDED_AVATAR,
        userRankId,
        userSettingsId: settings.id,
        profileId: profile.id,
        contributed,
        consumed,
        ratio,
        dateRegistered,
        lastLogin,
        disabled,
        isArtist: false,
        isDonor: false, // set later by misc generator
        canDownload: !disabled,
        // warned is DateTime? — store the first warning date if warned
        warned: warned ? daysAgo(1, 180, rng) : null,
        warnedTimes: warned ? randInt(1, 3, rng) : 0,
        inviteCount: archetype === 'power' ? randInt(0, 5, rng) : 0,
        adminComment:
          archetype === 'problem' || archetype === 'staff'
            ? makeAdminComment(rng)
            : null,
        staffBio,
        banDate: disabled ? daysAgo(1, 365, rng) : null,
        banReason: disabled
          ? 'Repeated rule violations — seed-generated'
          : null,
        ratioWatchDownload,
        lastIp: `10.${randInt(0, 255, rng)}.${randInt(0, 255, rng)}.${randInt(
          1,
          254,
          rng
        )}`
      }
    });

    createdUserIds.push(user.id);

    // Track created
    await trackCreate(
      prisma as Parameters<typeof trackCreate>[0],
      runId,
      'User',
      { id: user.id }
    );
    await trackCreate(
      prisma as Parameters<typeof trackCreate>[0],
      runId,
      'UserSettings',
      { id: settings.id }
    );
    await trackCreate(
      prisma as Parameters<typeof trackCreate>[0],
      runId,
      'Profile',
      { id: profile.id }
    );

    if (archetype === 'staff') {
      staffUserIds.push(user.id);
    }

    // Warnings for warned users
    if (warned && config.includeModerationData) {
      const warnCount = randInt(1, 3, rng);
      for (let w = 0; w < warnCount; w++) {
        const warnedBy =
          staffUserIds.length > 0 ? pick(staffUserIds, rng) : user.id;
        const warning = await prisma.userWarning.create({
          data: {
            userId: user.id,
            warnedById: warnedBy,
            reason: makeWarnReason(rng),
            createdAt: daysAgo(1, 180, rng)
          }
        });
        await trackCreate(
          prisma as Parameters<typeof trackCreate>[0],
          runId,
          'UserWarning',
          { id: warning.id }
        );
      }
    }

    // Edge cases
    if (config.includeEdgeCases && i === 0) {
      // First user: very long profile info
      await prisma.profile.update({
        where: { id: profile.id },
        data: {
          profileInfo:
            makeBBCodeProfile(rng).repeat(5).substring(0, 4000) +
            '\n\n[i]Edge case: long profile.[/i]'
        }
      });
    }
  }

  // Build a simple invite chain: 80% of users (after first) were invited by a prior generated user
  const baseUserCount = createdUserIds.length;
  for (let i = 1; i < baseUserCount; i++) {
    if (randBool(0.8, rng)) {
      const inviterIndex = randInt(0, i - 1, rng);
      const inviterId = createdUserIds[inviterIndex];
      const inviteeId = createdUserIds[i];

      try {
        const invite = await prisma.invite.create({
          data: {
            inviterId,
            inviteKey: `seed-${runId}-${i}`,
            email: makeSeedEmail(`seed_invite_${i + runOffset}`),
            status: 'accepted',
            expires: now
          }
        });
        await trackCreate(
          prisma as Parameters<typeof trackCreate>[0],
          runId,
          'Invite',
          { id: invite.id }
        );

        await prisma.inviteTree
          .create({
            data: { userId: inviteeId, inviterId }
          })
          .catch(() => {
            /* skip if already exists */
          });
      } catch {
        // Invite key collision — skip this invite
      }
    }
  }

  // Secondary ranks for some power/staff users
  if (midRanks.length > 0) {
    const secondaryRankCandidates = createdUserIds.filter(
      (_, idx) =>
        idx < staffUserIds.length + Math.floor(createdUserIds.length * 0.1)
    );
    for (const userId of secondaryRankCandidates) {
      if (randBool(0.3, rng)) {
        const secondaryRank = pick(midRanks, rng);
        try {
          await prisma.userSecondaryRank.create({
            data: {
              userId,
              userRankId: secondaryRank.id,
              assignedById:
                staffUserIds.length > 0 ? pick(staffUserIds, rng) : userId,
              createdAt: daysAgo(1, 365, rng)
            }
          });
          await trackCreate(
            prisma as Parameters<typeof trackCreate>[0],
            runId,
            'UserSecondaryRank',
            { userId, userRankId: secondaryRank.id }
          );
        } catch {
          // Duplicate secondary rank — skip
        }
      }
    }
  }

  // Populate context
  ctx.generatedUserIds = createdUserIds;
  ctx.generatedStaffUserIds = staffUserIds;

  // Update summary
  ctx.summary['User'] = createdUserIds.length;
}
