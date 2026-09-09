import { z } from 'zod';

// ReleaseGroup identity (ADR-0023, #265). `title` is the canonical display
// string; uniqueness is enforced on the normalized `identityKey` derived from
// these three fields by `identityKeyFor` in modules/releaseGroup.ts.

export const createReleaseGroupSchema = z.object({
  // VarChar(100) in the schema, matching Release.title.
  title: z.string().min(1).max(100).trim(),
  artistId: z.number().int().positive().nullable().optional(),
  // Bounded rather than open: a group year is an identity component, and a
  // typo'd 20244 would mint a permanent duplicate identity nothing dedups.
  year: z.number().int().min(1000).max(2999).nullable().optional()
});

// `null` detaches the release from whatever group it is on. Required rather
// than optional, so an omitted key cannot read as "detach".
export const setReleaseGroupSchema = z.object({
  releaseGroupId: z.number().int().positive().nullable()
});

export type CreateReleaseGroupInput = z.infer<typeof createReleaseGroupSchema>;
export type SetReleaseGroupInput = z.infer<typeof setReleaseGroupSchema>;

// ─── Curation verbs (#265 PR2) ───────────────────────────────────────────────

/** Canonical identity fields, reused by create, split's target and retitle. */
const identityFields = {
  title: z.string().min(1).max(100).trim(),
  artistId: z.number().int().positive().nullable().optional(),
  year: z.number().int().min(1000).max(2999).nullable().optional()
};

export const updateReleaseGroupSchema = z.object(identityFields);

export const mergeReleaseGroupSchema = z.object({
  sourceGroupId: z.number().int().positive()
});

export const splitReleaseGroupSchema = z.object({
  // At least one, or the verb is a no-op that still writes two log lines.
  releaseIds: z.array(z.number().int().positive()).min(1).max(200),
  ...identityFields
});

export const addCoverSchema = z.object({
  // https only. A cover is rendered in every viewer's browser, so a plain-http
  // source is a mixed-content failure on an https site rather than a nicety.
  image: z
    .string()
    .url()
    .max(2000)
    .refine((value) => value.startsWith('https://'), {
      message: 'Cover URL must be https'
    }),
  summary: z.string().max(500).nullable().optional()
});

export type UpdateReleaseGroupInput = z.infer<typeof updateReleaseGroupSchema>;
export type MergeReleaseGroupInput = z.infer<typeof mergeReleaseGroupSchema>;
export type SplitReleaseGroupInput = z.infer<typeof splitReleaseGroupSchema>;
export type AddCoverInput = z.infer<typeof addCoverSchema>;
