import { z } from 'zod';

export const friendCommentSchema = z.object({
  comment: z.string().max(500)
});

export type FriendCommentInput = z.infer<typeof friendCommentSchema>;
