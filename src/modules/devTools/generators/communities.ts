/**
 * devTools/generators/communities.ts
 *
 * Generates Community rows with varied types, registration statuses,
 * and DoNotContribute items.
 *
 * Coverage:
 *   Models: Community, DoNotContribute
 *   Edge cases: empty community (no releases), closed community,
 *               invite-only community, community with DNC items
 */

import { randomBytes } from 'crypto';

import {
  PrismaClient,
  CommunityType,
  RegistrationStatus
} from '@prisma/client';
import { RunContext } from '../types';
import { pick, randInt, randBool, daysAgo, SeedContext } from '../seedRandom';
import {
  makeCommunityName,
  makeCommunityDescription,
  makeDncName,
  makeDncComment
} from '../contentFactory';
import { trackCreate } from '../tracking';

// One community of each type, in order, then random after that
const ALL_COMMUNITY_TYPES: CommunityType[] = [
  'Music',
  'Applications',
  'EBooks',
  'ELearningVideos',
  'Audiobooks',
  'Comedy',
  'Comics'
];

const REGISTRATION_STATUSES: RegistrationStatus[] = [
  'open',
  'invite',
  'closed'
];
const REG_STATUS_WEIGHTS = [60, 30, 10]; // open is most common

export async function generateCommunities(
  prisma: PrismaClient,
  ctx: RunContext
): Promise<void> {
  const { config, runId } = ctx;
  const rng = new SeedContext(config.seed).fork('communities');

  if (ctx.generatedUserIds.length === 0) {
    await prisma.devSeedRun.update({
      where: { id: runId },
      data: {
        warnings: {
          push: 'generateCommunities: no generated users available — skipping'
        }
      }
    });
    return;
  }

  const staffUsers =
    ctx.generatedStaffUserIds.length > 0
      ? ctx.generatedStaffUserIds
      : ctx.generatedUserIds;

  const targetCount = Math.max(
    1,
    Math.round(config.counts.communities * config.scale)
  );

  const createdCommunityIds: number[] = [];

  // Random 32-bit offset keeps community names unique across runs with the same seed.
  const runOffset = randomBytes(4).readUInt32BE(0);

  for (let i = 0; i < targetCount; i++) {
    // Rotate through community types to ensure all types appear
    const communityType =
      i < ALL_COMMUNITY_TYPES.length
        ? ALL_COMMUNITY_TYPES[i]
        : pick(ALL_COMMUNITY_TYPES, rng);

    // Registration status — weight toward open
    const regStatus = (() => {
      const roll = rng.next() * 100;
      let acc = 0;
      for (let j = 0; j < REGISTRATION_STATUSES.length; j++) {
        acc += REG_STATUS_WEIGHTS[j];
        if (roll < acc) return REGISTRATION_STATUSES[j];
      }
      return 'open' as RegistrationStatus;
    })();

    const name = makeCommunityName(i + runOffset + 1, rng);
    const description = makeCommunityDescription(rng);
    const createdAt = daysAgo(30, 3 * 365, rng);

    const community = await prisma.community.create({
      data: {
        name,
        description,
        image: '',
        type: communityType,
        registrationStatus: regStatus,
        allowDuplicateFormats: randBool(0.3, rng),
        createdAt,
        updatedAt: createdAt
      }
    });

    await trackCreate(
      prisma as Parameters<typeof trackCreate>[0],
      runId,
      'Community',
      { id: community.id }
    );

    createdCommunityIds.push(community.id);

    // Add staff users as community staff
    for (const staffId of staffUsers.slice(0, 2)) {
      try {
        await prisma.community.update({
          where: { id: community.id },
          data: {
            staff: { connect: { id: staffId } }
          }
        });
      } catch {
        // Ignore if already connected
      }
    }

    // DoNotContribute items for ~40% of communities
    if (randBool(0.4, rng) && config.includeModerationData) {
      const dncCount = randInt(1, 4, rng);
      const creatorId = pick(staffUsers, rng);
      for (let d = 0; d < dncCount; d++) {
        const dnc = await prisma.doNotContribute.create({
          data: {
            name: makeDncName(rng),
            comment: makeDncComment(rng),
            communityId: community.id,
            userId: creatorId,
            createdAt: daysAgo(1, 365, rng)
          }
        });
        await trackCreate(
          prisma as Parameters<typeof trackCreate>[0],
          runId,
          'DoNotContribute',
          { id: dnc.id }
        );
      }
    }

    // Edge cases
    if (config.includeEdgeCases && i === 1) {
      // Second community: closed with no releases (dead community)
      await prisma.community.update({
        where: { id: community.id },
        data: { registrationStatus: 'closed' }
      });
    }
  }

  ctx.generatedCommunityIds = createdCommunityIds;
  ctx.summary['Community'] = createdCommunityIds.length;
}
