import { SubscriptionPage } from '@prisma/client';
import { z } from 'zod';

const actionSchema = z.enum(['subscribe', 'unsubscribe']);

export const subscribeSchema = z.object({
  topicId: z.number().int().positive(),
  action: actionSchema
});

export const subscribeCommentsSchema = z.object({
  page: z.enum(
    Object.values(SubscriptionPage) as [SubscriptionPage, ...SubscriptionPage[]]
  ),
  pageId: z.number().int().positive(),
  action: actionSchema
});

export type SubscribeInput = z.infer<typeof subscribeSchema>;
export type SubscribeCommentsInput = z.infer<typeof subscribeCommentsSchema>;
