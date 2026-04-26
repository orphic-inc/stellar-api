import { z } from 'zod';

const REPORT_TARGET_TYPES = [
  'User',
  'Release',
  'Artist',
  'ForumTopic',
  'ForumPost',
  'Comment',
  'Collage',
  'Post'
] as const;

const REPORT_STATUSES = ['Open', 'Claimed', 'Resolved'] as const;

const RESOLUTION_ACTIONS = [
  'Dismissed',
  'ContentRemoved',
  'UserWarned',
  'UserDisabled',
  'MetadataFixed',
  'Other'
] as const;

export const fileReportSchema = z.object({
  targetType: z.enum(REPORT_TARGET_TYPES),
  targetId: z.number().int().positive(),
  category: z.string().min(1).max(50),
  reason: z.string().min(1),
  evidence: z.string().optional()
});

export const resolveReportSchema = z.object({
  resolution: z.string().min(1),
  resolutionAction: z.enum(RESOLUTION_ACTIONS)
});

export const addNoteSchema = z.object({
  body: z.string().min(1)
});

export const reportListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  status: z.enum([...REPORT_STATUSES, 'all']).default('Open'),
  targetType: z.enum([...REPORT_TARGET_TYPES, 'all']).default('all'),
  claimedByMe: z.coerce.boolean().default(false)
});

export type FileReportInput = z.infer<typeof fileReportSchema>;
export type ResolveReportInput = z.infer<typeof resolveReportSchema>;
export type AddNoteInput = z.infer<typeof addNoteSchema>;
export type ReportListQueryInput = z.infer<typeof reportListQuerySchema>;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export type ReportResolutionAction = (typeof RESOLUTION_ACTIONS)[number];
