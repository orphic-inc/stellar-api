import { z } from 'zod';
import { staffReason } from './user';

// Staff actions on a member's whole invite subtree (#639).
export const INVITE_SUBTREE_ACTIONS = [
  'note',
  'disable',
  'revoke_invites'
] as const;

export const inviteSubtreeActionSchema = z.object({
  action: z.enum(INVITE_SUBTREE_ACTIONS),
  reason: staffReason,
  // The count the preview showed. A tree that has changed since is refused.
  expectedCount: z.number().int().positive()
});

export type InviteSubtreeAction = (typeof INVITE_SUBTREE_ACTIONS)[number];
export type InviteSubtreeActionInput = z.infer<
  typeof inviteSubtreeActionSchema
>;
