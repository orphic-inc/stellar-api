/**
 * devTools/generators/misc.ts
 *
 * Generates News, Blog/Post, GlobalNotice, SiteHistory, PrivateConversation,
 * PrivateMessage, MassMessage, Donation, UserDonorRank, and AuditLog rows.
 *
 * Coverage:
 *   Models: News, Post, GlobalNotice, SiteHistory, PrivateConversation,
 *           PrivateConversationParticipant, PrivateMessage, MassMessage,
 *           Donation, UserDonorRank, AuditLog
 */

import { PrismaClient } from '@prisma/client';
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
  makeNewsTitle,
  makeNewsBody,
  makeNoticeMessage,
  makeSiteHistoryTitle,
  makeSiteHistoryBody,
  makePmSubject,
  makePmBody
} from '../contentFactory';
import { trackCreate } from '../tracking';

const DONATION_CURRENCIES = ['USD', 'EUR', 'GBP'];
const DONATION_SOURCES = ['paypal', 'stripe', 'manual'];

export async function generateMisc(
  prisma: PrismaClient,
  ctx: RunContext
): Promise<void> {
  const { config, runId } = ctx;
  const rng = new SeedContext(config.seed).fork('misc');

  if (ctx.generatedUserIds.length === 0) return;

  const users = ctx.generatedUserIds;
  const staff =
    ctx.generatedStaffUserIds.length > 0
      ? ctx.generatedStaffUserIds
      : [users[0]];

  const section = config.sections;
  let totalCount = 0;

  // ─── News ──────────────────────────────────────────────────────────────────

  if (section.has('announcements')) {
    const newsCount = Math.max(
      2,
      Math.round(config.counts.newsItems * config.scale)
    );
    for (let i = 0; i < newsCount; i++) {
      const authorId = pick(staff, rng);
      const createdAt = daysAgo(0, 2 * 365, rng);
      const news = await prisma.news.create({
        data: {
          title: makeNewsTitle(rng),
          body: makeNewsBody(rng),
          createdAt
        }
      });
      await trackCreate(
        prisma as Parameters<typeof trackCreate>[0],
        runId,
        'News',
        { id: news.id }
      );
      totalCount++;

      // Blog post (Post model)
      if (randBool(0.5, rng)) {
        const post = await prisma.post.create({
          data: {
            userId: authorId,
            title: makeNewsTitle(rng),
            text: makeNewsBody(rng),
            category: pick(['news', 'blog', 'announcement'], rng),
            tags: [],
            createdAt
          }
        });
        await trackCreate(
          prisma as Parameters<typeof trackCreate>[0],
          runId,
          'Post',
          { id: post.id }
        );
      }
    }

    // Global notices (some active, some expired)
    const noticeCount = randInt(2, 5, rng);
    for (let i = 0; i < noticeCount; i++) {
      const isExpired = randBool(0.3, rng);
      const createdAt = daysAgo(1, 90, rng);
      const expiresAt = isExpired
        ? daysAgo(1, 30, rng)
        : new Date(Date.now() + randInt(1, 30, rng) * 24 * 60 * 60 * 1000);

      const notice = await prisma.globalNotice.create({
        data: {
          message: makeNoticeMessage(rng).substring(0, 500),
          url: randBool(0.3, rng) ? 'https://seed.invalid/news/1' : null,
          createdById: pick(staff, rng),
          expiresAt,
          createdAt
        }
      });
      await trackCreate(
        prisma as Parameters<typeof trackCreate>[0],
        runId,
        'GlobalNotice',
        { id: notice.id }
      );
      totalCount++;
    }

    // Site history entries
    const historyCount = Math.max(
      2,
      Math.round(config.counts.siteHistoryEntries * config.scale)
    );
    for (let i = 0; i < historyCount; i++) {
      const authorId = pick(staff, rng);
      const createdAt = daysAgo(0, 3 * 365, rng);
      const entry = await prisma.siteHistory.create({
        data: {
          authorId,
          title: makeSiteHistoryTitle(rng),
          body: makeSiteHistoryBody(rng),
          createdAt,
          updatedAt: createdAt
        }
      });
      await trackCreate(
        prisma as Parameters<typeof trackCreate>[0],
        runId,
        'SiteHistory',
        { id: entry.id }
      );
      totalCount++;
    }

    // Mass PM records (no external send)
    if (randBool(0.5, rng) && staff.length > 0) {
      const mass = await prisma.massMessage.create({
        data: {
          senderId: pick(staff, rng),
          subject: `[SEED] ${makeNewsTitle(rng)}`,
          body: makeNewsBody(rng),
          sentCount: randInt(1, 100, rng),
          createdAt: daysAgo(1, 365, rng)
        }
      });
      await trackCreate(
        prisma as Parameters<typeof trackCreate>[0],
        runId,
        'MassMessage',
        { id: mass.id }
      );
    }
  }

  // ─── Private Messages ──────────────────────────────────────────────────────

  if (section.has('messages') && users.length >= 2) {
    const pmCount = Math.max(
      1,
      Math.round(config.counts.pmConversations * config.scale)
    );
    for (let i = 0; i < pmCount; i++) {
      const participants = pickN(users, 2, rng);
      const [senderId, recipientId] = participants;
      const subject = makePmSubject(rng);
      const createdAt = daysAgo(0, 2 * 365, rng);

      const conversation = await prisma.privateConversation.create({
        data: {
          subject,
          createdAt,
          updatedAt: createdAt
        }
      });
      await trackCreate(
        prisma as Parameters<typeof trackCreate>[0],
        runId,
        'PrivateConversation',
        { id: conversation.id }
      );

      // Participants
      for (const [idx, participantId] of [senderId, recipientId].entries()) {
        await prisma.privateConversationParticipant.create({
          data: {
            userId: participantId,
            conversationId: conversation.id,
            inInbox: true,
            inSentbox: idx === 0,
            isRead: randBool(0.7, rng),
            isSticky: false,
            sentAt: idx === 0 ? createdAt : null,
            receivedAt: idx === 1 ? createdAt : null
          }
        });
        // Track composite key
        await trackCreate(
          prisma as Parameters<typeof trackCreate>[0],
          runId,
          'PrivateConversationParticipant',
          { userId: participantId, conversationId: conversation.id }
        );
      }

      // Messages in the conversation
      const msgCount = randInt(1, 5, rng);
      for (let m = 0; m < msgCount; m++) {
        const msgSenderId = m % 2 === 0 ? senderId : recipientId;
        const msgAt = new Date(createdAt.getTime() + m * 3600000);
        const message = await prisma.privateMessage.create({
          data: {
            conversationId: conversation.id,
            senderId: msgSenderId,
            body: makePmBody(rng),
            createdAt: msgAt
          }
        });
        await trackCreate(
          prisma as Parameters<typeof trackCreate>[0],
          runId,
          'PrivateMessage',
          { id: message.id }
        );
      }
      totalCount++;
    }
  }

  // ─── Donations ────────────────────────────────────────────────────────────

  if (section.has('donations')) {
    // Find or check for donor ranks
    const donorRanks = await prisma.donorRank.findMany();
    const donorUsers = pickN(
      users,
      Math.min(Math.floor(users.length * 0.1) + 1, users.length),
      rng
    );

    for (const donorUserId of donorUsers) {
      const amount = randInt(5, 200, rng);
      const currency = pick(DONATION_CURRENCIES, rng);
      const donatedAt = daysAgo(1, 2 * 365, rng);
      const addedById = pick(staff, rng);

      const donation = await prisma.donation.create({
        data: {
          userId: donorUserId,
          amount,
          email: `seed_donor_${donorUserId}@seed.invalid`,
          donatedAt,
          currency,
          source: pick(DONATION_SOURCES, rng),
          reason: 'Seed-generated donation',
          rank: 1,
          addedBy: addedById,
          totalRank: amount
        }
      });
      await trackCreate(
        prisma as Parameters<typeof trackCreate>[0],
        runId,
        'Donation',
        { id: donation.id }
      );

      // Grant donor rank if one exists
      if (donorRanks.length > 0) {
        const donorRank = pick(donorRanks, rng);
        try {
          const expiresAt = donorRank.expiresAfterDays
            ? new Date(
                donatedAt.getTime() + donorRank.expiresAfterDays * 86400000
              )
            : null;
          const udr = await prisma.userDonorRank.create({
            data: {
              userId: donorUserId,
              donorRankId: donorRank.id,
              grantedAt: donatedAt,
              expiresAt,
              grantedById: addedById
            }
          });
          await trackCreate(
            prisma as Parameters<typeof trackCreate>[0],
            runId,
            'UserDonorRank',
            { id: udr.id }
          );

          // Update isDonor flag
          await prisma.user.update({
            where: { id: donorUserId },
            data: { isDonor: true }
          });
        } catch {
          // User already has a donor rank — skip
        }
      }
      totalCount++;
    }
  }

  // ─── Audit Log entries for seed activity ─────────────────────────────────

  const auditCount = Math.min(10, staff.length * 3);
  for (let i = 0; i < auditCount; i++) {
    const actorId = pick(staff, rng);
    await prisma.auditLog.create({
      data: {
        actorId,
        action: pick(
          ['seed.generate', 'seed.review', 'seed.approve', 'seed.moderate'],
          rng
        ),
        targetType: pick(['User', 'Release', 'Community', 'Report'], rng),
        targetId: randInt(1, 999, rng),
        metadata: { source: 'seed', runId },
        createdAt: daysAgo(0, 30, rng)
      }
    });
  }

  ctx.summary['misc'] = totalCount;
}
