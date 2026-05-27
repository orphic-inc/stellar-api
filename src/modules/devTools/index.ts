/**
 * devTools/index.ts
 *
 * Orchestrator: resolves config, creates the DevSeedRun, runs generators
 * in dependency order, reconciles denormalized fields, and validates integrity.
 *
 * Coverage Matrix (Phase A–C — complete generator set):
 *
 * | Section       | Models                                              | Edge Cases                          |
 * |---------------|-----------------------------------------------------|-------------------------------------|
 * | users         | User, Profile, UserSettings, UserWarning,           | disabled, warned, ratio-watch,      |
 * |               | UserSecondaryRank, Invite, InviteTree               | staff, power, brand-new user        |
 * | communities   | Community, DoNotContribute                          | empty, closed, all CommunityTypes   |
 * | releases      | Artist, Release, Tag (seed.*), ReleaseTag,          | 0-contribution release, max tags,   |
 * |               | ReleaseTagVote, ReleaseHistory, ReleaseVote,        | edited release, artist with alias,  |
 * |               | ReleaseVoteAggregate, ArtistHistory, ArtistAlias,  | similar artists, no votes           |
 * |               | SimilarArtist, ArtistTag, BookmarkRelease, Comment  |                                     |
 * | contributions | Contribution, Consumer, Contributor,                | multi-contribution release,         |
 * |               | DownloadAccessGrant                                 | 0-contribution release (skip)       |
 * | collages      | Collage, CollageEntry, CollageSubscription,         | empty collage, near-max, locked     |
 * |               | BookmarkCollage, Comment                            |                                     |
 * | requests      | Request, RequestBounty, RequestFill, RequestVote,   | zero-bounty, max-bounty, ancient,   |
 * |               | RequestAction, RequestArtist, EconomyTransaction,  | 0-votes, filled same day, deleted   |
 * |               | RequestFill, Comment, BookmarkRequest               |                                     |
 * | wiki          | WikiPage, WikiRevision, WikiAlias                   | stub, large, high-read-level, alias |
 * | reports       | Report, ReportNote                                  | all target types, all statuses      |
 * | staffInbox    | StaffInboxConversation, StaffInboxMessage,          | all statuses, multi-message threads |
 * |               | StaffInboxResponse                                  |                                     |
 * | messages      | PrivateConversation, PrivateConversationParticipant,| multi-message conversations         |
 * |               | PrivateMessage                                      |                                     |
 * | announcements | News, Post, GlobalNotice, SiteHistory, MassMessage  | expired notices, old history        |
 * | stats         | UserStatSnapshot, SiteStatSnapshot, Top10Snapshot,  | sparse activity, trends             |
 * |               | Top10SnapshotEntry                                  |                                     |
 * | donations     | Donation, UserDonorRank                             | expired donor rank                  |
 * | moderation    | UserModerationNote                                  | multi-note users, staff authors     |
 * | forum         | ForumTopic, ForumPost, ForumPoll, ForumPollVote,    | integrated mode only; polls,        |
 * |               | ForumPostEdit, ForumTopicNote, ForumLastReadTopic   | notes, edits, read-position         |
 *
 * Known gaps (deferred):
 *   - FeaturedAlbum, FeaturedMerch (managed via announcements UI, not auto-seeded)
 *   - DonorReward, DonorForumUsername (donor perks UI, deferred)
 *   - RulesPage (static content, low priority)
 *   - Friend (social feature, low priority)
 */

import { prisma } from '../../lib/prisma';
import {
  GenerateConfig,
  ResolvedConfig,
  RunContext,
  makeRunContext,
  PRESET_COUNTS,
  SECTION_KEYS,
  SectionKey,
  PresetKey
} from './types';
import { reconcile } from './reconcile';
import { validate } from './validate';

import { generateUsers } from './generators/users';
import { generateCommunities } from './generators/communities';
import { generateReleases } from './generators/releases';
import { generateContributions } from './generators/contributions';
import { generateCollages } from './generators/collages';
import { generateRequests } from './generators/requests';
import { generateWiki } from './generators/wiki';
import { generateReports } from './generators/reports';
import { generateStaffInbox } from './generators/staffInbox';
import { generateStats } from './generators/stats';
import { generateMisc } from './generators/misc';
import { generateForum } from './generators/forum';
import { generateModeration } from './generators/moderation';

// ─── Config Resolution ────────────────────────────────────────────────────────

export function resolveConfig(raw: GenerateConfig): ResolvedConfig {
  const preset: PresetKey = raw.preset ?? 'balanced';
  const sections: Set<SectionKey> =
    raw.sections && raw.sections.length > 0
      ? new Set(raw.sections)
      : new Set(SECTION_KEYS);

  return {
    seed: raw.seed ?? 42,
    scale: Math.max(0.1, Math.min(10, raw.scale ?? 1)),
    preset,
    sections,
    mode: raw.mode ?? 'isolated',
    includeEdgeCases: raw.includeEdgeCases ?? true,
    includeModerationData: raw.includeModerationData ?? true,
    includeStatsData: raw.includeStatsData ?? true,
    dryRun: raw.dryRun ?? false,
    label: raw.label,
    counts: PRESET_COUNTS[preset]
  };
}

// ─── Estimate ────────────────────────────────────────────────────────────────

/**
 * Returns estimated entity counts without writing to the database.
 */
export function estimateCounts(config: ResolvedConfig): Record<string, number> {
  const { counts, scale, sections } = config;
  const estimate: Record<string, number> = {};

  const s = (n: number) => Math.max(1, Math.round(n * scale));

  if (sections.has('users')) estimate['User'] = s(counts.users);
  if (sections.has('communities'))
    estimate['Community'] = s(counts.communities);
  if (sections.has('releases')) {
    estimate['Release'] = s(counts.releasesPerCommunity * counts.communities);
    estimate['Artist'] = estimate['Release'];
  }
  if (sections.has('contributions')) {
    estimate['Contribution'] = s(estimate['Release'] ?? 0) * 1;
  }
  if (sections.has('collages')) estimate['Collage'] = s(counts.collages);
  if (sections.has('requests')) estimate['Request'] = s(counts.requests);
  if (sections.has('wiki')) estimate['WikiPage'] = s(counts.wikiPages);
  if (sections.has('reports')) estimate['Report'] = s(counts.reports);
  if (sections.has('staffInbox'))
    estimate['StaffInboxConversation'] = s(counts.staffTickets);
  if (sections.has('messages'))
    estimate['PrivateConversation'] = s(counts.pmConversations);
  if (sections.has('announcements')) {
    estimate['News'] = s(counts.newsItems);
    estimate['SiteHistory'] = s(counts.siteHistoryEntries);
  }
  if (sections.has('stats')) {
    estimate['UserStatSnapshot'] = s(counts.users) * 90;
    estimate['SiteStatSnapshot'] = 90;
  }
  if (sections.has('donations')) {
    estimate['Donation'] = Math.max(1, Math.round(s(counts.users) * 0.1));
  }
  if (sections.has('moderation') && config.includeModerationData !== false) {
    // ~25% of users are flagged; each gets 1–3 notes; ~70% get at least one
    estimate['UserModerationNote'] = Math.max(
      1,
      Math.round(s(counts.users) * 0.25 * 0.7 * 2)
    );
  }

  // Forum section warns if isolated
  if (sections.has('forum') && config.mode === 'isolated') {
    estimate['ForumTopic'] = 0; // unavailable in isolated mode
  }

  return estimate;
}

// ─── Main Orchestrator ────────────────────────────────────────────────────────

export interface RunResult {
  runId: string;
  summary: Record<string, number>;
  validation: Awaited<ReturnType<typeof validate>>;
  warnings: string[];
  dryRun: boolean;
}

export async function runGeneration(
  rawConfig: GenerateConfig,
  actorId: number
): Promise<RunResult> {
  const config = resolveConfig(rawConfig);

  // Dry run — return estimates without writing
  if (config.dryRun) {
    return {
      runId: 'dry-run',
      summary: estimateCounts(config),
      validation: { passed: true, checks: [] },
      warnings:
        config.sections.has('forum') && config.mode === 'isolated'
          ? [
              'Forum generator requires integrated mode and was not included in this estimate'
            ]
          : [],
      dryRun: true
    };
  }

  // Create the DevSeedRun record
  const run = await prisma.devSeedRun.create({
    data: {
      label: config.label,
      mode: config.mode,
      config: {
        seed: config.seed,
        scale: config.scale,
        preset: config.preset,
        sections: [...config.sections],
        mode: config.mode,
        includeEdgeCases: config.includeEdgeCases,
        includeModerationData: config.includeModerationData,
        includeStatsData: config.includeStatsData
      },
      summary: {},
      actorId,
      cleanupStatus: 'active',
      reversibilityLevel: 'full'
    }
  });

  const ctx: RunContext = makeRunContext(run.id, config);

  try {
    const { sections } = config;

    // 1. Users (must be first — all other generators depend on user IDs)
    if (sections.has('users')) {
      await generateUsers(prisma, ctx);
    }

    // 2. Communities
    if (sections.has('communities')) {
      await generateCommunities(prisma, ctx);
    }

    // 3. Releases (artists, tags)
    if (sections.has('releases')) {
      await generateReleases(prisma, ctx);
    }

    // 4. Contributions (depends on releases)
    if (sections.has('contributions')) {
      await generateContributions(prisma, ctx);
    }

    // 5. Collages (depends on releases)
    if (sections.has('collages')) {
      await generateCollages(prisma, ctx);
    }

    // 6. Requests (depends on communities, contributions, artists)
    if (sections.has('requests')) {
      await generateRequests(prisma, ctx);
    }

    // 7. Wiki (independent of releases/communities)
    if (sections.has('wiki')) {
      await generateWiki(prisma, ctx);
    }

    // 8. Reports (depends on users, releases, comments, etc.)
    if (sections.has('reports')) {
      await generateReports(prisma, ctx);
    }

    // 9. Staff inbox
    if (sections.has('staffInbox')) {
      await generateStaffInbox(prisma, ctx);
    }

    // 10. Miscellaneous (news, blog, notices, PMs, donations)
    if (
      sections.has('messages') ||
      sections.has('announcements') ||
      sections.has('donations')
    ) {
      await generateMisc(prisma, ctx);
    }

    // 11. Stats (last — depends on all generated entities)
    if (sections.has('stats')) {
      await generateStats(prisma, ctx);
    }

    // 12. Forum (integrated mode only)
    if (sections.has('forum')) {
      await generateForum(prisma, ctx);
    }

    // 13. Moderation notes (depends on users — generates UserModerationNote rows
    //     for warned/disabled users; runs after users so flagged IDs are set)
    if (sections.has('moderation')) {
      await generateModeration(prisma, ctx);
    }

    // Reconcile denormalized fields
    await reconcile(prisma, ctx);

    // Post-generation validation
    const validation = await validate(prisma, ctx);

    // Update the run summary
    await prisma.devSeedRun.update({
      where: { id: run.id },
      data: {
        summary: ctx.summary,
        warnings: ctx.warnings.length > 0 ? ctx.warnings : undefined,
        updatedAt: new Date()
      }
    });

    return {
      runId: run.id,
      summary: ctx.summary,
      validation,
      warnings: ctx.warnings,
      dryRun: false
    };
  } catch (err) {
    // Mark run as failed
    await prisma.devSeedRun
      .update({
        where: { id: run.id },
        data: {
          cleanupStatus: 'failed',
          warnings: [
            ...(ctx.warnings ?? []),
            `Generation failed: ${
              err instanceof Error ? err.message : String(err)
            }`
          ],
          updatedAt: new Date()
        }
      })
      .catch(() => {
        /* ignore update error */
      });
    throw err;
  }
}
