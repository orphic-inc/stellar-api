import { z } from 'zod';

export const createTicketSchema = z.object({
  subject: z.string().min(1, 'Subject is required').max(255),
  body: z.string().min(1, 'Body is required')
});

export const replySchema = z.object({
  body: z.string().min(1, 'Body is required')
});

export const assignSchema = z
  .object({
    assignedUserId: z.number().int().positive().nullable().optional(),
    assignedUsername: z.string().min(1).max(32).optional()
  })
  .refine(
    (d) => d.assignedUserId !== undefined || d.assignedUsername !== undefined,
    { message: 'assignedUserId or assignedUsername required' }
  );

const boolParam = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .default(false);

export const queueQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  status: z.enum(['all', 'Unanswered', 'Open', 'Resolved']).default('all'),
  assignedToMe: boolParam,
  unassigned: boolParam
});

export const bulkResolveSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, 'At least one id required')
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type ReplyInput = z.infer<typeof replySchema>;
export type AssignInput = z.infer<typeof assignSchema>;
export type QueueQueryInput = z.infer<typeof queueQuerySchema>;
export type BulkResolveInput = z.infer<typeof bulkResolveSchema>;
