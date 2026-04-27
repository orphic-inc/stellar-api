import { z } from 'zod';

export const composeMessageSchema = z
  .object({
    toUserId: z.number().int().positive().optional(),
    toUsername: z.string().min(1).max(32).optional(),
    subject: z.string().min(1, 'Subject is required').max(255),
    body: z.string().min(1, 'Body is required')
  })
  .refine(
    (data) =>
      data.toUserId !== undefined ||
      (data.toUsername !== undefined && data.toUsername.trim().length > 0),
    { message: 'recipient_required' }
  );

export const replyMessageSchema = z.object({
  body: z.string().min(1, 'Body is required')
});

export const updateConversationSchema = z
  .object({
    isSticky: z.boolean().optional(),
    isRead: z.boolean().optional()
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const bulkMessageActionSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, 'At least one id required'),
  action: z.enum(['delete', 'markRead', 'markUnread'])
});

export const messageListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  search: z.string().optional()
});

export const createTicketSchema = z.object({
  subject: z.string().min(1, 'Subject is required').max(255),
  body: z.string().min(1, 'Body is required')
});

export const assignTicketSchema = z.object({
  assignedUserId: z.number().int().positive().nullable().optional(),
  assignedUsername: z.string().min(1).max(32).optional()
});

// z.coerce.boolean() treats the query-string "false" as true (Boolean("false") === true).
// z.enum(['true','false']).transform() validates the literal strings and correctly maps them.
const boolParam = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .default(false);

export const ticketQueueQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  status: z.enum(['all', 'Unanswered', 'Open', 'Resolved']).default('all'),
  assignedToMe: boolParam,
  unassigned: boolParam
});

export type ComposeMessageInput = z.infer<typeof composeMessageSchema>;
export type ReplyMessageInput = z.infer<typeof replyMessageSchema>;
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;
export type BulkMessageActionInput = z.infer<typeof bulkMessageActionSchema>;
export type MessageListQueryInput = z.infer<typeof messageListQuerySchema>;
export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type AssignTicketInput = z.infer<typeof assignTicketSchema>;
export type TicketQueueQueryInput = z.infer<typeof ticketQueueQuerySchema>;
