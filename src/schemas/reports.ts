import { z } from 'zod';

const REPORT_TARGET_TYPES = [
  'User',
  'Release',
  'Artist',
  'Contribution',
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
  'MarkedDuplicate',
  'Other'
] as const;

export const RELEASE_REPORT_CATEGORIES = [
  'Dupe',
  'Trump',
  'BadFileNamesTrump',
  'BadFolderNameTrump',
  'TagTrump',
  'VinylTrump',
  'AudienceRecording',
  'BadFileNames',
  'BadFolderNames',
  'BadTagNoTag',
  'BonusTracksOnly',
  'DisallowedFormat',
  'DiscsMissing',
  'Discography',
  'MqaBanned',
  'EditedLog',
  'InaccurateBitrate',
  'LogRescoreRequest',
  'LossyMasterApprovalRequest',
  'ContributionContestApprovalRequest',
  'LowBitrate',
  'MuttRip',
  'NoLineageInfo',
  'Other',
  'RadioTvFmWebRip',
  'SkipsEncodeErrors',
  'SpecificallyBanned',
  'TracksMissing',
  'Transcode',
  'UnsplitAlbumRip',
  'Urgent',
  'UserCompilation',
  'WrongSpecifiedFormat',
  'WrongSpecifiedMedia'
] as const;

const NON_RELEASE_TARGET_TYPES = [
  'User',
  'Artist',
  'Contribution',
  'ForumTopic',
  'ForumPost',
  'Comment',
  'Collage',
  'Post'
] as const;

const targetIdField = z.number().int().positive();
const reasonField = z.string().min(1);
const evidenceField = z.string().optional();

export const fileReportSchema = z.union([
  z.object({
    targetType: z.literal('Release'),
    targetId: targetIdField,
    releaseCategory: z.enum(RELEASE_REPORT_CATEGORIES),
    reason: reasonField,
    evidence: evidenceField
  }),
  z.object({
    targetType: z.enum(NON_RELEASE_TARGET_TYPES),
    targetId: targetIdField,
    category: z.string().min(1).max(50),
    reason: reasonField,
    evidence: evidenceField
  })
]);

export const resolveReportSchema = z.object({
  resolution: z.string().min(1),
  resolutionAction: z.enum(RESOLUTION_ACTIONS)
});

export const addNoteSchema = z.object({
  body: z.string().min(1)
});

// z.coerce.boolean() treats the query-string "false" as true (Boolean("false") === true).
// z.enum(['true','false']).transform() validates the literal strings and correctly maps them.
const boolParam = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .default(false);

export const reportListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  status: z.enum([...REPORT_STATUSES, 'all']).default('Open'),
  targetType: z.enum([...REPORT_TARGET_TYPES, 'all']).default('all'),
  claimedByMe: boolParam,
  reporterUsername: z.string().optional()
});

export type FileReportInput = z.infer<typeof fileReportSchema>;
export type ResolveReportInput = z.infer<typeof resolveReportSchema>;
export type AddNoteInput = z.infer<typeof addNoteSchema>;
export type ReportListQueryInput = z.infer<typeof reportListQuerySchema>;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export type ReportResolutionAction = (typeof RESOLUTION_ACTIONS)[number];
export type ReleaseReportCategoryValue =
  (typeof RELEASE_REPORT_CATEGORIES)[number];
