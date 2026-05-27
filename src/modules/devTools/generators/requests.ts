/**
 * devTools/generators/requests.ts
 *
 * Generates Request, RequestBounty, RequestVote, RequestFill, RequestAction,
 * RequestArtist, Comment, and EconomyTransaction rows.
 *
 * Coverage:
 *   Models: Request, RequestBounty, RequestVote, RequestFill, RequestAction,
 *           RequestArtist, EconomyTransaction, Comment, BookmarkRequest
 *   Edge cases: zero-bounty request, max-bounty request, ancient request,
 *               request filled same day, request with 0 votes
 */

import { PrismaClient, RequestStatus } from '@prisma/client';
import { RunContext } from '../types';
import {
  pick,
  pickN,
  randInt,
  randBool,
  daysAgo,
  SeedContext
} from '../seedRandom';
import {
  makeRequestTitle,
  makeArtistName,
  makeReleaseDescription,
  makeBBCodeForumPost
} from '../contentFactory';
import { trackCreate } from '../tracking';

// Status distribution: 60% open, 30% filled, 10% deleted
const REQUEST_STATUSES: RequestStatus[] = ['open', 'filled', 'deleted'];
const STATUS_WEIGHTS = [60, 30, 10];

function pickStatus(rng: SeedContext): RequestStatus {
  const r = rng.next() * 100;
  let acc = 0;
  for (let i = 0; i < REQUEST_STATUSES.length; i++) {
    acc += STATUS_WEIGHTS[i];
    if (r < acc) return REQUEST_STATUSES[i];
  }
  return 'open';
}

const RELEASE_TYPES = [
  'Music',
  'Applications',
  'EBooks',
  'ELearningVideos',
  'Audiobooks'
] as const;

export async function generateRequests(
  prisma: PrismaClient,
  ctx: RunContext
): Promise<void> {
  const { config, runId } = ctx;
  const rng = new SeedContext(config.seed).fork('requests');

  if (
    ctx.generatedUserIds.length === 0 ||
    ctx.generatedCommunityIds.length === 0
  ) {
    return;
  }

  const users = ctx.generatedUserIds;
  const communities = ctx.generatedCommunityIds;
  const targetCount = Math.max(
    2,
    Math.round(config.counts.requests * config.scale)
  );

  const createdRequestIds: number[] = [];

  for (let i = 0; i < targetCount; i++) {
    const requesterId = pick(users, rng);
    const communityId = pick(communities, rng);
    const status = pickStatus(rng);
    const artistName = makeArtistName(rng);
    const title = makeRequestTitle(artistName, rng);
    const description = makeReleaseDescription(rng);
    const type = pick(RELEASE_TYPES, rng);
    const year = randBool(0.7, rng) ? randInt(1960, 2024, rng) : undefined;

    // Edge cases
    const isAncient = config.includeEdgeCases && i === 0;
    const isZeroBounty = config.includeEdgeCases && i === 1;
    const isMaxBounty = config.includeEdgeCases && i === 2;

    const createdAt = isAncient
      ? daysAgo(3 * 365, 5 * 365, rng)
      : daysAgo(0, 2 * 365, rng);

    let fillerId: number | null = null;
    let filledAt: Date | null = null;
    let filledContributionId: number | null = null;

    if (status === 'filled') {
      fillerId = pick(users, rng);
      filledAt = new Date(
        createdAt.getTime() + randInt(1, 180, rng) * 24 * 60 * 60 * 1000
      );
      // Reference a generated contribution if available
      if (ctx.generatedContributionIds.length > 0) {
        filledContributionId = pick(ctx.generatedContributionIds, rng);
      }
    }

    const request = await prisma.request.create({
      data: {
        communityId,
        userId: requesterId,
        title: title.substring(0, 255),
        description: description.substring(0, 2000),
        type,
        year,
        status,
        fillerId,
        filledAt,
        filledContributionId,
        voteCount: 0, // reconciled later
        createdAt,
        updatedAt: createdAt
      }
    });
    createdRequestIds.push(request.id);
    await trackCreate(
      prisma as Parameters<typeof trackCreate>[0],
      runId,
      'Request',
      { id: request.id }
    );

    // Link artist to request
    if (ctx.generatedArtistIds.length > 0 && randBool(0.5, rng)) {
      try {
        const reqArtist = await prisma.requestArtist.create({
          data: {
            requestId: request.id,
            artistId: pick(ctx.generatedArtistIds, rng)
          }
        });
        await trackCreate(
          prisma as Parameters<typeof trackCreate>[0],
          runId,
          'RequestArtist',
          { id: reqArtist.id }
        );
      } catch {
        // Duplicate — skip
      }
    }

    // CREATE action
    const createAction = await prisma.requestAction.create({
      data: {
        requestId: request.id,
        actorId: requesterId,
        action: 'CREATE',
        metadata: {},
        createdAt
      }
    });
    await trackCreate(
      prisma as Parameters<typeof trackCreate>[0],
      runId,
      'RequestAction',
      { id: createAction.id }
    );

    // Economy transaction for creation
    const createTx = await prisma.economyTransaction.create({
      data: {
        userId: requesterId,
        amount: 0n,
        reason: 'REQUEST_CREATE',
        contextId: request.id,
        contextType: 'Request',
        actorUserId: requesterId,
        createdAt
      }
    });
    await trackCreate(
      prisma as Parameters<typeof trackCreate>[0],
      runId,
      'EconomyTransaction',
      { id: createTx.id }
    );

    // Bounties
    if (!isZeroBounty && status !== 'deleted') {
      const bountyCount = isMaxBounty
        ? Math.min(10, users.length)
        : randInt(0, Math.min(5, users.length), rng);

      const bountyUsers = pickN(users, bountyCount, rng);
      for (const bountyUserId of bountyUsers) {
        const bountyAmount = isMaxBounty
          ? 100_000_000n
          : BigInt(randInt(1000, 100_000, rng));

        try {
          const bounty = await prisma.requestBounty.create({
            data: {
              requestId: request.id,
              userId: bountyUserId,
              amount: bountyAmount,
              createdAt: daysAgo(0, 365, rng)
            }
          });
          await trackCreate(
            prisma as Parameters<typeof trackCreate>[0],
            runId,
            'RequestBounty',
            { id: bounty.id }
          );

          // ADD_BOUNTY action
          const bountyAction = await prisma.requestAction.create({
            data: {
              requestId: request.id,
              actorId: bountyUserId,
              action: 'ADD_BOUNTY',
              metadata: { amount: bountyAmount.toString() },
              createdAt: daysAgo(0, 365, rng)
            }
          });
          await trackCreate(
            prisma as Parameters<typeof trackCreate>[0],
            runId,
            'RequestAction',
            { id: bountyAction.id }
          );

          // Economy transaction for bounty
          const bountyTx = await prisma.economyTransaction.create({
            data: {
              userId: bountyUserId,
              amount: -bountyAmount,
              reason: 'REQUEST_VOTE',
              contextId: request.id,
              contextType: 'Request',
              actorUserId: bountyUserId,
              createdAt: daysAgo(0, 365, rng)
            }
          });
          await trackCreate(
            prisma as Parameters<typeof trackCreate>[0],
            runId,
            'EconomyTransaction',
            { id: bountyTx.id }
          );
        } catch {
          // Duplicate — skip
        }
      }
    }

    // Votes
    const voteCount =
      config.includeEdgeCases && i === 3
        ? 0 // zero votes edge case
        : randInt(0, Math.min(20, users.length), rng);

    const voters = pickN(users, voteCount, rng);
    for (const voterId of voters) {
      try {
        const vote = await prisma.requestVote.create({
          data: {
            requestId: request.id,
            userId: voterId,
            createdAt: daysAgo(0, 365, rng)
          }
        });
        await trackCreate(
          prisma as Parameters<typeof trackCreate>[0],
          runId,
          'RequestVote',
          { id: vote.id }
        );
      } catch {
        // Duplicate — skip
      }
    }

    // Fill action & economy for filled requests
    if (status === 'filled' && fillerId) {
      const fillAction = await prisma.requestAction.create({
        data: {
          requestId: request.id,
          actorId: fillerId,
          action: 'FILL',
          metadata: {},
          createdAt: filledAt!
        }
      });
      await trackCreate(
        prisma as Parameters<typeof trackCreate>[0],
        runId,
        'RequestAction',
        { id: fillAction.id }
      );

      if (filledContributionId) {
        const fillRecord = await prisma.requestFill.create({
          data: {
            requestId: request.id,
            contributionId: filledContributionId,
            fillerId,
            awardedAmount: BigInt(randInt(0, 50_000, rng)),
            createdAt: filledAt!
          }
        });
        await trackCreate(
          prisma as Parameters<typeof trackCreate>[0],
          runId,
          'RequestFill',
          { id: fillRecord.id }
        );
      }

      const fillTx = await prisma.economyTransaction.create({
        data: {
          userId: fillerId,
          amount: BigInt(randInt(1000, 50_000, rng)),
          reason: 'REQUEST_FILL',
          contextId: request.id,
          contextType: 'Request',
          actorUserId: fillerId,
          createdAt: filledAt!
        }
      });
      await trackCreate(
        prisma as Parameters<typeof trackCreate>[0],
        runId,
        'EconomyTransaction',
        { id: fillTx.id }
      );
    }

    // Comments on requests
    if (status !== 'deleted') {
      const commentCount = randBool(0.5, rng) ? randInt(1, 4, rng) : 0;
      for (let c = 0; c < commentCount; c++) {
        const commenterId = pick(users, rng);
        const comment = await prisma.comment.create({
          data: {
            page: 'requests',
            authorId: commenterId,
            body: makeBBCodeForumPost(rng).substring(0, 800),
            requestId: request.id,
            createdAt: daysAgo(0, 365, rng)
          }
        });
        await trackCreate(
          prisma as Parameters<typeof trackCreate>[0],
          runId,
          'Comment',
          { id: comment.id }
        );
        ctx.generatedCommentIds.push(comment.id);
      }
    }

    // Bookmarks
    if (status !== 'deleted' && randBool(0.3, rng)) {
      const bookmarker = pick(users, rng);
      try {
        await prisma.bookmarkRequest.create({
          data: {
            userId: bookmarker,
            requestId: request.id,
            createdAt: daysAgo(0, 365, rng)
          }
        });
      } catch {
        // Duplicate — skip
      }
    }
  }

  ctx.generatedRequestIds = createdRequestIds;
  ctx.summary['Request'] = createdRequestIds.length;
}
