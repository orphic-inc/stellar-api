import { z } from 'zod';

// Request/response shapes for POST /api/log-check. The result mirrors the
// LogCheckResult returned by src/modules/logChecker — score is floored at 0 at the
// module boundary, so min(0) here is a real guarantee, not a clamp.

// 1 MiB cap: real EAC/XLD logs are a few KB; UTF-16 doubles byte size but the body
// is a decoded string by the time it reaches us. The cap is a guardrail, not a fit.
export const logCheckRequestSchema = z.object({
  log: z.string().min(1).max(1_000_000)
});

export const deductionSchema = z.object({
  message: z.string(),
  points: z.number()
});

export const logCheckResultSchema = z.object({
  ripper: z.enum(['EAC', 'XLD']).nullable(),
  version: z.string().nullable(),
  score: z.number().int().min(0).max(100),
  isPerfect: z.boolean(),
  deductions: z.array(deductionSchema)
});

export type LogCheckRequest = z.infer<typeof logCheckRequestSchema>;
export type LogCheckResultDTO = z.infer<typeof logCheckResultSchema>;
