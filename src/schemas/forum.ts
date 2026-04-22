import { z } from 'zod';

export const createForumSchema = z.object({
  forumCategoryId: z.number().int().positive('forumCategoryId is required'),
  sort: z.number().int().default(0),
  name: z.string().min(1, 'Name is required').max(128),
  description: z.string().max(1024).optional(),
  minClassRead: z.number().int().min(0).default(0),
  minClassWrite: z.number().int().min(0).default(0),
  minClassCreate: z.number().int().min(0).default(0),
  autoLock: z.boolean().default(true),
  autoLockWeeks: z.number().int().min(1).default(4)
});

export const createTopicSchema = z.object({
  title: z.string().min(1, 'Title is required').max(256),
  body: z.string().min(1, 'Body is required'),
  question: z.string().max(512).optional(),
  answers: z.string().optional()
});

export const updateTopicSchema = z.object({
  title: z.string().min(1).max(256).optional(),
  isLocked: z.boolean().optional(),
  isSticky: z.boolean().optional()
});

export const createPostSchema = z.object({
  body: z.string().min(1, 'Body is required')
});

export const updatePostSchema = z.object({
  body: z.string().min(1, 'Body is required')
});

export type CreateForumInput = z.infer<typeof createForumSchema>;
export type CreateTopicInput = z.infer<typeof createTopicSchema>;
export type UpdateTopicInput = z.infer<typeof updateTopicSchema>;
export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;
