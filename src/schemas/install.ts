import { z } from 'zod';

export const installSchema = z.object({
  username: z.string().min(1, 'Username is required').max(30),
  email: z.string().email('Please include a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters')
});

export const announcementSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  body: z.string().min(1, 'Body is required')
});

export const stylesheetSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  cssUrl: z.string().min(1, 'CSS URL is required')
});

export const postSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  text: z.string().min(1, 'Text is required'),
  category: z.string().min(1, 'Category is required'),
  tags: z.array(z.string()).optional()
});

export const postCommentSchema = z.object({
  text: z.string().min(1, 'Text is required')
});

export const pollSchema = z.object({
  forumTopicId: z.number().int().positive(),
  question: z.string().min(1, 'Question is required'),
  answers: z.string().min(1, 'Answers are required')
});

export const pollVoteSchema = z.object({
  forumPollId: z.number().int().positive(),
  vote: z.number().int()
});

export const topicNoteSchema = z.object({
  forumTopicId: z.number().int().positive(),
  body: z.string().min(1, 'Body is required')
});

export const lastReadSchema = z.object({
  forumTopicId: z.number().int().positive(),
  forumPostId: z.number().int().positive()
});

export const artistSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  vanityHouse: z.boolean().optional()
});

export const similarArtistSchema = z.object({
  artistId: z.number().int().positive(),
  similarArtistId: z.number().int().positive()
});

export const artistAliasSchema = z.object({
  artistId: z.number().int().positive(),
  redirectId: z.number().int().positive()
});

export const artistTagSchema = z.object({
  artistId: z.number().int().positive(),
  tagId: z.number().int().positive()
});

export type InstallInput = z.infer<typeof installSchema>;
