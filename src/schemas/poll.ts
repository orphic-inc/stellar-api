import { z } from 'zod';

export const pollSchema = z.object({
  forumTopicId: z.number().int().positive(),
  question: z.string().min(1, 'Question is required'),
  answers: z.string().min(1, 'Answers are required')
});

export const pollVoteSchema = z.object({
  forumPollId: z.number().int().positive(),
  vote: z.number().int().min(0)
});

export type PollVoteInput = z.infer<typeof pollVoteSchema>;
export type PollInput = z.infer<typeof pollSchema>;
