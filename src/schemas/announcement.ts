import { z } from 'zod';
import { paginationBase } from '../lib/pagination';

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

// The paginated news list (#670). `news.xml` publishes FEED_SIZE items and
// links each to the homepage anchor, so the UI needs to reach further back
// than the 5 rows `GET /announcements` carries for first paint.
export const newsListQuerySchema = z.object({ ...paginationBase });

export type NewsListQuery = z.infer<typeof newsListQuerySchema>;
