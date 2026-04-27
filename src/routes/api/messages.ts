import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
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

// POST /api/messages — compose new conversation
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

// GET /api/messages/:id — view conversation
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

// POST /api/messages/:id/reply — reply to conversation
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
      const statusMap: Record<string, number> = {
        not_participant: 403
      };
      return res
        .status(statusMap[result.reason] ?? 400)
        .json({ msg: result.reason });
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
