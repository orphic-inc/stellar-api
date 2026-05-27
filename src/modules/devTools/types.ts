/**
 * devTools/types.ts
 *
 * Shared type definitions for the test-data generator.
 */

// ─── Modes & Sections ─────────────────────────────────────────────────────────

export type GenerationMode = 'isolated' | 'integrated';

export const SECTION_KEYS = [
  'users',
  'communities',
  'releases',
  'contributions',
  'collages',
  'requests',
  'forum',
  'wiki',
  'reports',
  'staffInbox',
  'messages',
  'announcements',
  'stats',
  'moderation',
  'donations',
  'invites'
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

export const PRESET_KEYS = [
  'minimal',
  'balanced',
  'large',
  'edge_case'
] as const;

export type PresetKey = (typeof PRESET_KEYS)[number];

// ─── Preset Base Counts ───────────────────────────────────────────────────────

export interface PresetCounts {
  users: number;
  communities: number;
  releasesPerCommunity: number;
  collages: number;
  requests: number;
  wikiPages: number;
  forumTopics: number;
  reports: number;
  staffTickets: number;
  newsItems: number;
  siteHistoryEntries: number;
  pmConversations: number;
}

export const PRESET_COUNTS: Record<PresetKey, PresetCounts> = {
  minimal: {
    users: 5,
    communities: 2,
    releasesPerCommunity: 5,
    collages: 2,
    requests: 5,
    wikiPages: 3,
    forumTopics: 5,
    reports: 3,
    staffTickets: 3,
    newsItems: 3,
    siteHistoryEntries: 5,
    pmConversations: 3
  },
  balanced: {
    users: 50,
    communities: 5,
    releasesPerCommunity: 20,
    collages: 10,
    requests: 30,
    wikiPages: 15,
    forumTopics: 40,
    reports: 20,
    staffTickets: 15,
    newsItems: 10,
    siteHistoryEntries: 20,
    pmConversations: 20
  },
  large: {
    users: 200,
    communities: 10,
    releasesPerCommunity: 50,
    collages: 40,
    requests: 100,
    wikiPages: 40,
    forumTopics: 150,
    reports: 60,
    staffTickets: 40,
    newsItems: 25,
    siteHistoryEntries: 60,
    pmConversations: 80
  },
  edge_case: {
    users: 20,
    communities: 3,
    releasesPerCommunity: 10,
    collages: 5,
    requests: 15,
    wikiPages: 8,
    forumTopics: 15,
    reports: 15,
    staffTickets: 10,
    newsItems: 5,
    siteHistoryEntries: 10,
    pmConversations: 5
  }
};

// ─── Config ───────────────────────────────────────────────────────────────────

export interface GenerateConfig {
  seed?: number;
  scale?: number;
  preset?: PresetKey;
  sections?: SectionKey[];
  mode?: GenerationMode;
  includeEdgeCases?: boolean;
  includeModerationData?: boolean;
  includeStatsData?: boolean;
  dryRun?: boolean;
  label?: string;
}

export interface ResolvedConfig {
  seed: number;
  scale: number;
  preset: PresetKey;
  sections: Set<SectionKey>;
  mode: GenerationMode;
  includeEdgeCases: boolean;
  includeModerationData: boolean;
  includeStatsData: boolean;
  dryRun: boolean;
  label?: string;
  counts: PresetCounts;
}

// ─── Run Context ──────────────────────────────────────────────────────────────

/**
 * Mutable context passed between generators so each can reference
 * entities created by earlier generators.
 */
export interface RunContext {
  runId: string;
  config: ResolvedConfig;
  warnings: string[];

  // IDs of generated entities (populated as generators run)
  generatedUserIds: number[];
  generatedStaffUserIds: number[]; // subset with staff/admin rank
  generatedCommunityIds: number[];
  generatedArtistIds: number[];
  generatedReleaseIds: number[];
  generatedContributionIds: number[];
  generatedCollageIds: number[];
  generatedRequestIds: number[];
  generatedForumTopicIds: number[];
  generatedWikiPageIds: number[];
  generatedReportIds: number[];
  generatedStaffInboxIds: number[];
  generatedCommentIds: number[];

  // Summary counts (populated as generators run)
  summary: Record<string, number>;
}

export function makeRunContext(
  runId: string,
  config: ResolvedConfig
): RunContext {
  return {
    runId,
    config,
    warnings: [],
    generatedUserIds: [],
    generatedStaffUserIds: [],
    generatedCommunityIds: [],
    generatedArtistIds: [],
    generatedReleaseIds: [],
    generatedContributionIds: [],
    generatedCollageIds: [],
    generatedRequestIds: [],
    generatedForumTopicIds: [],
    generatedWikiPageIds: [],
    generatedReportIds: [],
    generatedStaffInboxIds: [],
    generatedCommentIds: [],
    summary: {}
  };
}

// ─── Generator Result ─────────────────────────────────────────────────────────

export interface GeneratorResult {
  entityType: string;
  count: number;
  ids: number[];
}

// ─── Cleanup Result ───────────────────────────────────────────────────────────

export interface CleanupResult {
  runId: string;
  status: 'cleaned' | 'partial' | 'failed';
  deletedCounts: Record<string, number>;
  revertedMutationCounts: number;
  warnings: string[];
  failedItems: Array<{ entityType: string; pk: unknown; error: string }>;
}

// ─── Validation Result ────────────────────────────────────────────────────────

export interface ValidationCheck {
  name: string;
  passed: boolean;
  message?: string;
}

export interface ValidationResult {
  passed: boolean;
  checks: ValidationCheck[];
}

// ─── Status & Estimate ────────────────────────────────────────────────────────

export interface DevStatus {
  enabled: boolean;
  environment: string;
  runCount: number;
  jobsEnabled: boolean;
}

export interface EstimateResult {
  counts: Record<string, number>;
  warnings: string[];
  sections: SectionKey[];
  mode: GenerationMode;
}
