import { z } from 'zod';

export const ircActivitySchema = z.object({
  // UTC day the counts belong to; defaults to today when omitted.
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'day must be YYYY-MM-DD')
    .optional(),
  entries: z
    .array(
      z.object({
        username: z.string().min(1).max(64),
        // IRC channel name: leading '#', no whitespace or commas.
        channel: z.string().regex(/^#[^\s,]{1,49}$/, 'invalid channel'),
        count: z.number().int().nonnegative()
      })
    )
    .min(1)
    .max(1000)
});

export type IrcActivityInput = z.infer<typeof ircActivitySchema>;

// Delegated SASL validation (ADR-0011): account = userId, password = IRCKey.
export const saslValidateSchema = z.object({
  account: z.string().min(1).max(32),
  password: z.string().min(1).max(64)
});

export type SaslValidateInput = z.infer<typeof saslValidateSchema>;
