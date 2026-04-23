import { z } from 'zod';

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
