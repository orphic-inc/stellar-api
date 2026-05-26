import { z } from 'zod';

export const announcementSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  body: z.string().min(1, 'Body is required')
});

export type AnnouncementInput = z.infer<typeof announcementSchema>;

export const globalNoticeSchema = z.object({
  message: z.string().min(1, 'Message is required').max(500),
  url: z.string().url('Must be a valid URL').optional(),
  expiresAt: z.string().datetime({ offset: true }).optional()
});

export type GlobalNoticeInput = z.infer<typeof globalNoticeSchema>;
