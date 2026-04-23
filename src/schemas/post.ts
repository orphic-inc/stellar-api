import { z } from 'zod';

export const postSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  text: z.string().min(1, 'Text is required'),
  category: z.string().min(1, 'Category is required'),
  tags: z.array(z.string()).optional()
});

export const postCommentSchema = z.object({
  text: z.string().min(1, 'Text is required')
});
