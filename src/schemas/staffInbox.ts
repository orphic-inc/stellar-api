import { z } from 'zod';

export const createTicketSchema = z.object({
  subject: z.string().min(1, 'Subject is required').max(255),
  body: z.string().min(1, 'Body is required')
});

export const replyTicketSchema = z.object({
  body: z.string().min(1, 'Body is required')
});

export const assignTicketSchema = z.object({
  assignedUserId: z.number().int().positive().nullable()
});

export const bulkResolveSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, 'At least one id required')
});

export const ticketListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  status: z.enum(['Unanswered', 'Open', 'Resolved', 'all']).default('all'),
  assignedToMe: z.coerce.boolean().default(false)
});

export const createResponseSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  body: z.string().min(1, 'Body is required')
});

export const updateResponseSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    body: z.string().min(1).optional()
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type ReplyTicketInput = z.infer<typeof replyTicketSchema>;
export type AssignTicketInput = z.infer<typeof assignTicketSchema>;
export type BulkResolveInput = z.infer<typeof bulkResolveSchema>;
export type TicketListQueryInput = z.infer<typeof ticketListQuerySchema>;
export type CreateResponseInput = z.infer<typeof createResponseSchema>;
export type UpdateResponseInput = z.infer<typeof updateResponseSchema>;
