/**
 * devTools/generators/staffInbox.ts
 *
 * Generates StaffInboxConversation, StaffInboxMessage, and
 * StaffInboxResponse (canned responses) rows.
 *
 * Coverage:
 *   Models: StaffInboxConversation, StaffInboxMessage, StaffInboxResponse
 *   Edge cases: all status states, multi-message threads
 */

import { PrismaClient, StaffInboxStatus } from '@prisma/client';
import { RunContext } from '../types';
import { pick, randInt, randBool, daysAgo, SeedContext } from '../seedRandom';
import {
  makeTicketSubject,
  makeTicketBody,
  makeStaffReply,
  CANNED_RESPONSES
} from '../contentFactory';
import { trackCreate } from '../tracking';

const TICKET_STATUSES: StaffInboxStatus[] = ['Unanswered', 'Open', 'Resolved'];
const STATUS_WEIGHTS = [35, 35, 30];

function pickStatus(rng: SeedContext): StaffInboxStatus {
  const r = rng.next() * 100;
  let acc = 0;
  for (let i = 0; i < TICKET_STATUSES.length; i++) {
    acc += STATUS_WEIGHTS[i];
    if (r < acc) return TICKET_STATUSES[i];
  }
  return 'Unanswered';
}

export async function generateStaffInbox(
  prisma: PrismaClient,
  ctx: RunContext
): Promise<void> {
  const { config, runId } = ctx;
  const rng = new SeedContext(config.seed).fork('staffInbox');

  if (ctx.generatedUserIds.length === 0) return;

  const users = ctx.generatedUserIds;
  const staff =
    ctx.generatedStaffUserIds.length > 0
      ? ctx.generatedStaffUserIds
      : [users[0]];
  const targetCount = Math.max(
    1,
    Math.round(config.counts.staffTickets * config.scale)
  );

  const createdInboxIds: number[] = [];

  // Create canned responses first
  for (const cr of CANNED_RESPONSES) {
    try {
      const cannedResp = await prisma.staffInboxResponse.create({
        data: { name: `[SEED] ${cr.name}`, body: cr.body }
      });
      await trackCreate(
        prisma as Parameters<typeof trackCreate>[0],
        runId,
        'StaffInboxResponse',
        { id: cannedResp.id }
      );
    } catch {
      // Skip if name already exists
    }
  }

  for (let i = 0; i < targetCount; i++) {
    const userId = pick(users, rng);
    const status = pickStatus(rng);
    const createdAt = daysAgo(0, 2 * 365, rng);

    let assignedUserId: number | null = null;
    let resolverId: number | null = null;

    if (status === 'Open' || status === 'Resolved') {
      assignedUserId = pick(staff, rng);
    }
    if (status === 'Resolved') {
      resolverId = pick(staff, rng);
    }

    const conversation = await prisma.staffInboxConversation.create({
      data: {
        subject: makeTicketSubject(rng),
        userId,
        status,
        assignedUserId,
        resolverId,
        isReadByUser: randBool(0.7, rng),
        createdAt,
        updatedAt: createdAt
      }
    });
    createdInboxIds.push(conversation.id);
    await trackCreate(
      prisma as Parameters<typeof trackCreate>[0],
      runId,
      'StaffInboxConversation',
      { id: conversation.id }
    );

    // Initial user message
    const userMsg = await prisma.staffInboxMessage.create({
      data: {
        conversationId: conversation.id,
        senderId: userId,
        body: makeTicketBody(rng),
        createdAt
      }
    });
    await trackCreate(
      prisma as Parameters<typeof trackCreate>[0],
      runId,
      'StaffInboxMessage',
      { id: userMsg.id }
    );

    // Staff reply (if not Unanswered)
    if (status !== 'Unanswered' && assignedUserId) {
      const replyAt = new Date(
        createdAt.getTime() + randInt(1, 72, rng) * 60 * 60 * 1000
      );
      const staffMsg = await prisma.staffInboxMessage.create({
        data: {
          conversationId: conversation.id,
          senderId: assignedUserId,
          body: makeStaffReply(rng),
          createdAt: replyAt
        }
      });
      await trackCreate(
        prisma as Parameters<typeof trackCreate>[0],
        runId,
        'StaffInboxMessage',
        { id: staffMsg.id }
      );

      // Optional follow-up user message
      if (randBool(0.3, rng)) {
        const followAt = new Date(
          replyAt.getTime() + randInt(1, 48, rng) * 60 * 60 * 1000
        );
        const followMsg = await prisma.staffInboxMessage.create({
          data: {
            conversationId: conversation.id,
            senderId: userId,
            body: makeTicketBody(rng),
            createdAt: followAt
          }
        });
        await trackCreate(
          prisma as Parameters<typeof trackCreate>[0],
          runId,
          'StaffInboxMessage',
          { id: followMsg.id }
        );
      }
    }
  }

  ctx.generatedStaffInboxIds = createdInboxIds;
  ctx.summary['StaffInboxConversation'] = createdInboxIds.length;
}
