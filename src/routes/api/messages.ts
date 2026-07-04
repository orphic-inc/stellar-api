import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/permissions';
import {
  validate,
  validateParams,
  validateQuery,
  parsedBody,
  parsedParams,
  parsedQuery
} from '../../middleware/validate';
import {
  composeMessageSchema,
  replyMessageSchema,
  updateConversationSchema,
  bulkMessageActionSchema,
  messageListQuerySchema,
  type ComposeMessageInput,
  type ReplyMessageInput,
  type UpdateConversationInput,
  type BulkMessageActionInput,
  type MessageListQueryInput
} from '../../schemas/pm';
import {
  pmDraftSchema,
  massPmSchema,
  type PmDraftInput,
  type MassPmInput
} from '../../schemas/user';
import {
  listInbox,
  listSentbox,
  sendMessage,
  replyToConversation,
  viewConversation,
  updateConversationFlags,
  deleteConversation,
  bulkUpdateConversations,
  getUnreadCount
} from '../../modules/pm';
import { AppError } from '../../lib/errors';

const router = express.Router();

const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { msg: 'Too many messages sent. Please wait before trying again.' },
  standardHeaders: true,
  legacyHeaders: false
});

const conversationIdSchema = z.object({
  id: z.coerce.number().int().positive()
});

const draftIdSchema = z.object({
  id: z.coerce.number().int().positive()
});

async function resolveDraftRecipient(
  explicitUserId: number | undefined,
  toUsername: string | undefined
) {
  if (explicitUserId) return explicitUserId;

  const username = toUsername?.trim();
  if (!username) return undefined;

  const found = await prisma.user.findFirst({
    where: { username }
  });
  if (!found) throw new AppError(404, 'recipient_not_found');

  return found.id;
}

// GET /api/messages — inbox list
router.get(
  '/',
  requireAuth,
  validateQuery(messageListQuerySchema),
  authHandler(async (req, res) => {
    const { page, search } = parsedQuery<MessageListQueryInput>(res);
    const result = await listInbox(req.user.id, page, search);
    res.json(result);
  })
);

// GET /api/messages/unread-count
router.get(
  '/unread-count',
  requireAuth,
  authHandler(async (req, res) => {
    const count = await getUnreadCount(req.user.id);
    res.json({ count });
  })
);

// GET /api/messages/sent — sentbox list
router.get(
  '/sent',
  requireAuth,
  validateQuery(messageListQuerySchema),
  authHandler(async (req, res) => {
    const { page } = parsedQuery<MessageListQueryInput>(res);
    const result = await listSentbox(req.user.id, page);
    res.json(result);
  })
);

// GET /api/messages/drafts — list drafts
router.get(
  '/drafts',
  requireAuth,
  authHandler(async (req, res) => {
    const drafts = await prisma.pmDraft.findMany({
      where: { userId: req.user.id },
      orderBy: { updatedAt: 'desc' }
    });
    const toUserIds = [
      ...new Set(drafts.filter((d) => d.toUserId).map((d) => d.toUserId!))
    ];
    const toUsers =
      toUserIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: toUserIds } },
            select: { id: true, username: true }
          })
        : [];
    const toUserMap = Object.fromEntries(toUsers.map((u) => [u.id, u]));
    const result = drafts.map((d) => ({
      ...d,
      toUser: d.toUserId ? toUserMap[d.toUserId] ?? null : null
    }));
    res.json(result);
  })
);

// POST /api/messages/drafts — create draft
router.post(
  '/drafts',
  requireAuth,
  validate(pmDraftSchema),
  authHandler(async (req, res) => {
    const {
      toUserId: explicitUserId,
      toUsername,
      subject,
      body
    } = parsedBody<PmDraftInput>(res);
    const toUserId = await resolveDraftRecipient(explicitUserId, toUsername);
    const draft = await prisma.pmDraft.create({
      data: {
        userId: req.user.id,
        ...(toUserId !== undefined && { toUserId }),
        subject,
        body
      }
    });
    res.status(201).json(draft);
  })
);

// PUT /api/messages/drafts/:id — update draft
router.put(
  '/drafts/:id',
  requireAuth,
  validateParams(draftIdSchema),
  validate(pmDraftSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const {
      toUserId: explicitUserId,
      toUsername,
      subject,
      body
    } = parsedBody<PmDraftInput>(res);
    const toUserId = await resolveDraftRecipient(explicitUserId, toUsername);

    const draft = await prisma.pmDraft.findFirst({
      where: { id, userId: req.user.id }
    });
    if (!draft) return res.status(404).json({ msg: 'Draft not found' });

    const updated = await prisma.pmDraft.update({
      where: { id },
      data: {
        ...(toUserId !== undefined ? { toUserId } : { toUserId: null }),
        subject,
        body
      }
    });
    res.json(updated);
  })
);

// DELETE /api/messages/drafts/:id — delete draft
router.delete(
  '/drafts/:id',
  requireAuth,
  validateParams(draftIdSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const draft = await prisma.pmDraft.findFirst({
      where: { id, userId: req.user.id }
    });
    if (!draft) return res.status(404).json({ msg: 'Draft not found' });
    await prisma.pmDraft.delete({ where: { id } });
    res.status(204).send();
  })
);

// POST /api/messages/mass — send mass PM
router.post(
  '/mass',
  ...requirePermission('messages_mass_pm'),
  validate(massPmSchema),
  authHandler(async (req, res) => {
    const { subject, body, targetRankId } = parsedBody<MassPmInput>(res);

    const users = await prisma.user.findMany({
      where: {
        disabled: false,
        ...(targetRankId !== undefined ? { userRankId: targetRankId } : {})
      },
      select: { id: true },
      take: 1000
    });

    let sentCount = 0;
    for (const target of users) {
      if (target.id === req.user.id) continue;
      await prisma.privateConversation.create({
        data: {
          subject,
          messages: { create: { senderId: req.user.id, body } },
          participants: {
            create: [
              {
                userId: target.id,
                inInbox: true,
                inSentbox: false,
                isRead: false,
                receivedAt: new Date()
              },
              {
                userId: req.user.id,
                inInbox: false,
                inSentbox: true,
                isRead: true,
                sentAt: new Date()
              }
            ]
          }
        }
      });
      sentCount++;
    }

    await prisma.massMessage.create({
      data: { senderId: req.user.id, subject, body, sentCount }
    });

    res.json({ sentCount });
  })
);

// POST /api/messages/bulk — bulk action on multiple conversations
router.post(
  '/bulk',
  requireAuth,
  validate(bulkMessageActionSchema),
  authHandler(async (req, res) => {
    const { ids, action } = parsedBody<BulkMessageActionInput>(res);
    await bulkUpdateConversations(req.user.id, ids, action);
    res.status(204).send();
  })
);

// POST /api/messages — compose new PM
router.post(
  '/',
  requireAuth,
  sendLimiter,
  validate(composeMessageSchema),
  authHandler(async (req, res) => {
    const { toUserId, toUsername, subject, body } =
      parsedBody<ComposeMessageInput>(res);

    let targetId = toUserId;
    if (!targetId && toUsername) {
      const normalized = toUsername.trim();
      const target = await prisma.user.findFirst({
        where: { username: { equals: normalized, mode: 'insensitive' } },
        select: { id: true }
      });
      if (!target) return res.status(404).json({ msg: 'recipient_not_found' });
      targetId = target.id;
    }

    const result = await sendMessage(req.user.id, targetId!, subject, body);
    if (!result.ok) {
      const statusMap: Record<string, number> = {
        self_message: 400,
        recipient_not_found: 404,
        recipient_disabled: 422,
        recipient_pm_disabled: 422
      };
      return res
        .status(statusMap[result.reason] ?? 400)
        .json({ msg: result.reason });
    }
    res.status(201).json(result.conversation);
  })
);

// GET /api/messages/:id — view PM conversation
router.get(
  '/:id',
  requireAuth,
  validateParams(conversationIdSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const result = await viewConversation(id, req.user.id);
    if (!result.ok)
      return res.status(404).json({ msg: 'Conversation not found' });
    res.json(result.conversation);
  })
);

// POST /api/messages/:id/reply — reply to PM
router.post(
  '/:id/reply',
  requireAuth,
  sendLimiter,
  validateParams(conversationIdSchema),
  validate(replyMessageSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { body } = parsedBody<ReplyMessageInput>(res);
    const result = await replyToConversation(id, req.user.id, body);
    if (!result.ok) {
      return res.status(403).json({ msg: result.reason });
    }
    res.status(201).json(result.message);
  })
);

// PATCH /api/messages/:id — update flags (sticky, read)
router.patch(
  '/:id',
  requireAuth,
  validateParams(conversationIdSchema),
  validate(updateConversationSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const flags = parsedBody<UpdateConversationInput>(res);
    const result = await updateConversationFlags(id, req.user.id, flags);
    if (!result.ok)
      return res.status(404).json({ msg: 'Conversation not found' });
    res.status(204).send();
  })
);

// DELETE /api/messages/:id — soft delete conversation for this user
router.delete(
  '/:id',
  requireAuth,
  validateParams(conversationIdSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const result = await deleteConversation(id, req.user.id);
    if (!result.ok)
      return res.status(404).json({ msg: 'Conversation not found' });
    res.status(204).send();
  })
);

export default router;
