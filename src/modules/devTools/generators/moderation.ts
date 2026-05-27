/**
 * devTools/generators/moderation.ts
 *
 * Generates UserModerationNote rows for flagged generated users
 * (warned or disabled users in the run).
 *
 * Coverage:
 *   Models: UserModerationNote
 *   Edge cases: multiple notes per user, notes authored by different staff members
 */

import { PrismaClient } from '@prisma/client';
import { RunContext } from '../types';
import { pick, randInt, randBool, daysAgo, SeedContext } from '../seedRandom';
import { trackCreate } from '../tracking';

const NOTE_BODIES = [
  'User contacted about ratio violation. Warned per standard policy.',
  'Second warning issued. User acknowledged policy breach.',
  'Suspicious download pattern detected. Monitoring for 30 days.',
  'User reported for comment harassment. Reviewed and cautioned.',
  'Account flagged for investigation — possible multi-account.',
  'Banned after repeat violations. Appeal window: 30 days.',
  'Ratio watch period extended due to continued inactivity.',
  'VPN usage detected. User advised on policy compliance.',
  'Chargeback dispute resolved in user favour. Account restored.',
  'Escalated from helpdesk — repeated rule violation claims.',
  'Note from senior moderator: treat with caution on next report.',
  'User self-reported issue with ratio. Manually adjusted.',
  'Pattern of low-quality contributions. Raised with team.',
  'Inactive for 12+ months — considered for pruning in next cycle.',
  'Restored after successful appeal. Probationary period: 60 days.'
];

export async function generateModeration(
  prisma: PrismaClient,
  ctx: RunContext
): Promise<void> {
  const { config, runId } = ctx;
  const rng = new SeedContext(config.seed).fork('moderation');

  if (!config.includeModerationData) return;
  if (ctx.generatedUserIds.length === 0) return;

  const users = ctx.generatedUserIds;
  const staffUsers =
    ctx.generatedStaffUserIds.length > 0
      ? ctx.generatedStaffUserIds
      : users.slice(0, 1); // fallback to first user if no staff generated

  // Fetch warned/disabled users from the generated set
  const flaggedUsers = await prisma.user.findMany({
    where: {
      id: { in: users },
      OR: [
        { warned: { not: null } },
        { disabled: true },
        { warnedTimes: { gt: 0 } }
      ]
    },
    select: { id: true }
  });

  if (flaggedUsers.length === 0) {
    // No flagged users — add notes to a random sample anyway (realistic: some
    // notes exist for users who were investigated but not formally warned)
    const sampleSize = Math.max(1, Math.floor(users.length * 0.05));
    for (let i = 0; i < sampleSize; i++) {
      const userId = pick(users, rng);
      const authorId = pick(staffUsers, rng);
      await createNote(prisma, runId, userId, authorId, rng);
    }
    return;
  }

  const createdNoteIds: number[] = [];

  for (const { id: userId } of flaggedUsers) {
    // Each flagged user gets 1–3 moderation notes
    if (randBool(0.3, rng)) continue; // 30% chance of no note (sparse coverage)

    const noteCount = randInt(1, 3, rng);
    for (let n = 0; n < noteCount; n++) {
      const authorId = pick(staffUsers, rng);
      const id = await createNote(prisma, runId, userId, authorId, rng);
      if (id !== null) createdNoteIds.push(id);
    }
  }

  ctx.summary['UserModerationNote'] = createdNoteIds.length;
}

async function createNote(
  prisma: PrismaClient,
  runId: string,
  userId: number,
  authorId: number,
  rng: SeedContext
): Promise<number | null> {
  try {
    const note = await prisma.userModerationNote.create({
      data: {
        userId,
        authorId,
        body: pick(NOTE_BODIES, rng),
        createdAt: daysAgo(1, 365, rng)
      }
    });
    await trackCreate(
      prisma as Parameters<typeof trackCreate>[0],
      runId,
      'UserModerationNote',
      { id: note.id }
    );
    return note.id;
  } catch {
    return null;
  }
}
