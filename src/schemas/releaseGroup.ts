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
