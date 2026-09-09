import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  AssetKind,
  CommunityType,
  EconomyTransactionReason,
  DownloadGrantStatus,
  FileType,
  InviteStatus,
  NotificationType,
  RatioPolicyStatus,
  ReleaseCategory,
  ReleaseType,
  RegistrationStatus,
  ReportStatus,
  ReportTargetType,
  SubscriptionPage,
  RequestStatus,
  RequestActionType
} from '@prisma/client';
import { appVersion } from './version';
import type { Operation } from './openapiCompleteness';
import { type GateKind, expectedCodes, type Gate } from './routeGate';
import {
  profileUpdateSchema,
  inviteSchema,
  donorRewardUpdateSchema,
  donorForumTitleUpdateSchema
} from '../schemas/profile';
import {
  adminCreateUserSchema,
  userSettingsSchema,
  warnUserSchema,
  moderationNoteSchema,
  donorRankSchema,
  grantDonorSchema,
  ircNickVerifySchema,
  setRankSchema,
  rankLockSchema,
  staffBioSchema,
  dncSchema,
  // pmDraftSchema and massPmSchema live in schemas/user.ts, not schemas/pm.ts.
  pmDraftSchema,
  massPmSchema
} from '../schemas/user';
import {
  createContributionSchema,
  addContributionToReleaseSchema,
  contributionReportSchema,
  ratioExemptSchema
} from '../schemas/contribution';
import {
  createCollageSchema,
  updateCollageSchema,
  collageQuerySchema,
  addEntrySchema,
  reorderEntriesSchema
} from '../schemas/collage';
import {
  createWikiPageSchema,
  updateWikiPageSchema,
  addAliasSchema,
  wikiSearchQuerySchema,
  wikiCompareQuerySchema
} from '../schemas/wiki';
import {
  createCommunitySchema,
  updateCommunitySchema,
  createGroupSchema,
  updateGroupSchema,
  releaseVoteSchema,
  releaseTagSchema,
  releaseTagVoteSchema,
  addMemberSchema
} from '../schemas/community';
import {
  updateRequestSchema,
  unfillRequestSchema,
  listRequestsQuerySchema,
  createRequestSchema,
  addBountySchema,
  fillRequestSchema
} from '../schemas/requests';
import {
  logCheckRequestSchema,
  logCheckResultSchema
} from '../schemas/logCheck';
import {
  createForumSchema,
  updateForumSchema,
  createTopicSchema,
  updateTopicSchema,
  createPostSchema,
  updatePostSchema,
  topicNoteSchema,
  lastReadSchema
} from '../schemas/forum';
import {
  createForumCategorySchema,
  updateForumCategorySchema
} from '../schemas/forumCategory';
import { pollSchema, pollVoteSchema } from '../schemas/poll';
import {
  artistSchema,
  similarArtistSchema,
  artistAliasSchema,
  artistTagSchema,
  vanityHouseSchema
} from '../schemas/artist';
import {
  stylesheetSchema,
  stylesheetUpdateSchema,
  authorStylesheetSchema
} from '../schemas/stylesheet';
import {
  subscribeSchema,
  subscribeCommentsSchema
} from '../schemas/subscription';
import {
  announcementSchema,
  globalNoticeSchema
} from '../schemas/announcement';
import { createRulesPageSchema, updateRulesPageSchema } from '../schemas/rules';
import {
  createTagAliasSchema,
  updateTagAliasSchema
} from '../schemas/tagAliases';
import { featuredAlbumSchema } from '../schemas/featuredAlbum';
import { createRankSchema, updateRankSchema } from '../schemas/tools';
import {
  createStaffGroupSchema,
  updateStaffGroupSchema
} from '../schemas/staff';
import { VALID_PERMISSIONS } from './rankPermissions';
import { postSchema, postCommentSchema } from '../schemas/post';
import {
  commentQuerySchema,
  createCommentSchema,
  updateCommentSchema
} from '../schemas/comment';
import { installSchema } from '../schemas/install';
import { updateSettingsSchema } from '../schemas/settings';
import { friendCommentSchema } from '../schemas/friends';
import { ratioPolicyOverrideSchema } from '../schemas/ratioPolicy';
import { createDonationSchema } from '../schemas/donations';
import { grantAccessSchema, reverseGrantSchema } from '../schemas/downloads';
import { snapshotSchema } from '../schemas/top10';
import {
  fileReportSchema,
  resolveReportSchema,
  addNoteSchema
} from '../schemas/reports';
import {
  searchReleasesQuerySchema,
  searchArtistsQuerySchema,
  searchRequestsQuerySchema,
  searchLogQuerySchema,
  searchUsersQuerySchema
} from '../schemas/search';

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// ─── Shared response schemas ──────────────────────────────────────────────────

registry.register('MsgResponse', z.object({ msg: z.string() }));

registry.register('ErrorResponse', z.object({ error: z.string() }));

registry.register(
  'ValidationError',
  z.object({
    msg: z.string(),
    errors: z.record(z.string(), z.array(z.string()))
  })
);

/**
 * One `responses` entry whose body is `{ msg }`, and its validation sibling.
 *
 * 356 registrations wrote the same `content` wrapper out longhand before #562;
 * these say it once. The description stays at the call site, because that is
 * the only part of the block that ever carried information — 168 operations
 * declare a 404 across 50 distinct descriptions, and none of them is derivable
 * (measured on #517; see the issue for why 404s are NOT derived the way the
 * 401/403/429 are).
 *
 * THE `$ref` IS A LITERAL ON PURPOSE, not the registered Zod object. These
 * serve two callers with opposite needs. A `registerPath` call site is fed
 * through `OpenApiGeneratorV3`, which accepts either. `responsesForGates` is
 * not: `applyGateDerivations` splices into the ALREADY-GENERATED document,
 * where a Zod schema is emitted verbatim as garbage instead of being converted.
 * A literal `$ref` is the one form both paths render identically, which is what
 * lets a single helper cover the hand-written blocks and the derived ones.
 *
 * That is also why the schemas above are registered without a `const` binding:
 * nothing references them any more, and `ErrorResponse` was already written
 * that way.
 *
 * Both live HERE, above the 352 top-level `registry.registerPath` calls, rather
 * than beside the derivation code that first needed them. `const` does not
 * hoist, and those calls run at module evaluation — defined below them, the
 * first call site throws `ReferenceError: Cannot access 'msgResponse' before
 * initialization` on import of this file, which `app.ts` imports.
 */
export const msgResponse = (description: string) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/MsgResponse' }
    }
  }
});

export const validationResponse = (description: string) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ValidationError' }
    }
  }
});

const PaginationMeta = registry.register(
  'PaginationMeta',
  z.object({
    total: z.number(),
    page: z.number(),
    limit: z.number(),
    totalPages: z.number()
  })
);

const StaffUserRef = z.object({ id: z.number(), username: z.string() });

// #231 — the shared author identity for every PostBox-rendering surface (forum
// posts/topics, comments, blog-post comments, PMs, staff inbox). Carries the
// donor sign + warning sign so they follow the user site-wide, mirroring the
// fields the profile shapes already expose. `donorRank` is null when no active
// (unexpired) grant exists; `warned` is the ISO timestamp of the active warning
// or null. Backed by src/modules/authorRef.ts.
const AuthorRef = registry.register(
  'AuthorRef',
  z.object({
    id: z.number(),
    username: z.string(),
    avatar: z.string().nullable(),
    isDonor: z.boolean(),
    donorRank: z
      .object({
        name: z.string(),
        badge: z.string(),
        color: z.string()
      })
      .nullable(),
    warned: z.string().nullable()
  })
);

// ─── Auth ─────────────────────────────────────────────────────────────────────

const LoginBody = registry.register(
  'LoginBody',
  z.object({
    email: z.string().email(),
    password: z.string().min(1)
  })
);

const RegisterBody = registry.register(
  'RegisterBody',
  z.object({
    username: z.string().min(1).max(32),
    email: z.string().email(),
    password: z.string().min(6),
    inviteKey: z.string().optional()
  })
);

const AuthUser = registry.register(
  'AuthUser',
  z.object({
    id: z.number(),
    username: z.string(),
    email: z.string().email().optional(),
    avatar: z.string().nullable(),
    inviteCount: z.number().optional(),
    dateRegistered: z.string().optional(),
    lastLogin: z.string().nullable().optional(),
    isArtist: z.boolean().optional(),
    isDonor: z.boolean().optional(),
    canDownload: z.boolean().optional(),
    contributed: z.string().optional(),
    consumed: z.string().optional(),
    ratio: z.number().optional(),
    userRank: z.object({
      level: z.number(),
      name: z.string(),
      color: z.string(),
      badge: z.string().optional(),
      permissions: z.record(z.string(), z.boolean()).optional(),
      personalCollageLimit: z.number().int().optional(),
      authorStylesheetLimit: z.number().int().optional(),
      assetLimit: z.number().int().nullable().optional()
    })
  })
);

registry.registerPath({
  method: 'post',
  path: '/auth',
  tags: ['Auth'],
  request: { body: { content: { 'application/json': { schema: LoginBody } } } },
  responses: {
    200: {
      description: 'JWT issued, user returned',
      content: {
        'application/json': {
          schema: z.object({ user: AuthUser })
        }
      }
    },
    400: msgResponse('Invalid credentials'),
    403: msgResponse('Account disabled')
  }
});

registry.registerPath({
  method: 'post',
  path: '/auth/register',
  tags: ['Auth'],
  summary: 'Public self-registration',
  description:
    'Ungated — no session, no permission — so the 403 here is the handler ' +
    "speaking, not middleware: it is the site's registration policy " +
    'refusing, and every branch of it concerns the invite. The 400 is the ' +
    'submission itself being unusable. A request-body validation failure ' +
    'also answers 400, carrying an `errors` object this schema does not ' +
    'show.',
  request: {
    body: { content: { 'application/json': { schema: RegisterBody } } }
  },
  responses: {
    200: {
      description: 'Registered and logged in',
      content: {
        'application/json': {
          schema: z.object({ user: AuthUser })
        }
      }
    },
    400: msgResponse(
      'Username or email already taken, the password is on the denylist, ' +
        'or the address is not accepted'
    ),
    403: msgResponse(
      'Registration is closed, or the invite key is missing, invalid, ' +
        'already used, or issued for a different email address'
    )
  }
});

registry.registerPath({
  method: 'post',
  path: '/auth/logout',
  tags: ['Auth'],
  responses: {
    204: {
      description: 'Logged out'
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/auth',
  tags: ['Auth'],
  responses: {
    200: {
      description: 'Current user',
      content: { 'application/json': { schema: AuthUser } }
    }
  }
});

const ChangePasswordBody = registry.register(
  'ChangePasswordBody',
  z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8)
  })
);

const ChangeEmailBody = registry.register(
  'ChangeEmailBody',
  z.object({
    newEmail: z.string().email(),
    password: z.string().min(1)
  })
);

const RecoveryRequestBody = registry.register(
  'RecoveryRequestBody',
  z.object({ email: z.string().email() })
);

const RecoveryResetBody = registry.register(
  'RecoveryResetBody',
  z.object({
    token: z.string().min(1),
    newPassword: z.string().min(8)
  })
);

const UserSession = registry.register(
  'UserSession',
  z.object({
    // cuid, not an integer id.
    id: z.string(),
    userId: z.number().int(),
    ipAddress: z.string(),
    userAgent: z.string().nullable(),
    createdAt: z.string(),
    lastActiveAt: z.string(),
    // Always null on the list route, which returns active sessions only.
    revokedAt: z.string().nullable(),
    // Computed per request, not a column: true for the session whose id the
    // caller's token carries. The client cannot derive this — the id lives in
    // an HttpOnly cookie — so the server has to say.
    isCurrent: z.boolean()
  })
);

registry.registerPath({
  method: 'post',
  path: '/auth/password',
  tags: ['Auth'],
  summary: 'Change the password of the authenticated member',
  request: {
    body: { content: { 'application/json': { schema: ChangePasswordBody } } }
  },
  responses: {
    204: {
      description: 'Password changed'
    },
    400: msgResponse('Current password incorrect, or the new one is disallowed')
  }
});

registry.registerPath({
  method: 'put',
  path: '/auth/email',
  tags: ['Auth'],
  summary: 'Change the email of the authenticated member',
  description:
    'Requires the current password. The originating IP is recorded with the ' +
    'change.',
  request: {
    body: { content: { 'application/json': { schema: ChangeEmailBody } } }
  },
  responses: {
    200: msgResponse('Email updated'),
    400: msgResponse('Password incorrect, or the email is already in use')
  }
});

registry.registerPath({
  method: 'post',
  path: '/auth/recovery/request',
  tags: ['Auth'],
  summary: 'Request an account-recovery email',
  description:
    'Always answers 200 with the same generic message, whether or not the ' +
    'address belongs to an account. That is deliberate: a distinguishable ' +
    'response would make this an account-enumeration oracle. There is no 404 ' +
    'here by design. Rate-limited by authLimiter.',
  request: {
    body: { content: { 'application/json': { schema: RecoveryRequestBody } } }
  },
  responses: {
    200: msgResponse(
      'Generic acknowledgement — identical for a known and an unknown address'
    )
  }
});

registry.registerPath({
  method: 'post',
  path: '/auth/recovery/reset',
  tags: ['Auth'],
  summary: 'Reset a password using a recovery token',
  description: 'Rate-limited by authLimiter.',
  request: {
    body: { content: { 'application/json': { schema: RecoveryResetBody } } }
  },
  responses: {
    200: msgResponse('Password reset'),
    400: msgResponse(
      'Invalid or expired token, or the new password is disallowed'
    )
  }
});

registry.registerPath({
  method: 'get',
  path: '/auth/sessions',
  tags: ['Auth'],
  summary: 'Active sessions for the authenticated member',
  description:
    'Revoked sessions are excluded, so `revokedAt` is always null here. ' +
    'Ordered by `lastActiveAt`, most recent first.',
  responses: {
    200: {
      description: 'Active sessions',
      content: { 'application/json': { schema: z.array(UserSession) } }
    }
  }
});

registry.registerPath({
  method: 'delete',
  path: '/auth/sessions/{id}',
  tags: ['Auth'],
  summary: 'Revoke one of your own sessions',
  description:
    "Scoped to the caller: another member's session id answers 404 rather " +
    'than 403, so the endpoint does not confirm that the id exists.',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: {
      description: 'Session revoked'
    },
    404: msgResponse('No such session belonging to the caller')
  }
});

// ─── Install ──────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/install',
  tags: ['Install'],
  responses: {
    200: {
      description: 'Install status',
      content: {
        'application/json': {
          schema: z.object({
            installed: z.boolean(),
            registrationStatus: z.enum(['open', 'invite', 'closed']),
            // Asymmetric on purpose (#333): the handler flattens configWarnings
            // to `.message`, but setupChecklist keeps its `id` because that is
            // what a dismissal writes to `dismissedLaunchChecklist`. Declaring
            // both as string[] made generated clients type a field that never
            // holds strings.
            configWarnings: z.array(z.string()),
            setupChecklist: z.array(
              z.object({ id: z.string(), message: z.string() })
            )
          })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/install',
  tags: ['Install'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: installSchema
        }
      }
    }
  },
  responses: {
    201: {
      description: 'Installation complete',
      content: {
        'application/json': {
          schema: z.object({ user: AuthUser })
        }
      }
    },
    400: msgResponse(
      'A user with that username or email already exists. A request-body ' +
        'validation failure also answers 400, carrying an `errors` object ' +
        'this schema does not show'
    ),
    409: msgResponse('Application already installed')
  }
});

registry.registerPath({
  method: 'post',
  path: '/install/checklist/{id}/dismiss',
  tags: ['Install'],
  summary: 'Staff: dismiss one launch-checklist item',
  description:
    'Idempotent — the dismissed ids are held as a set, so re-dismissing the ' +
    'same item changes nothing. Requires the `staff` permission.',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: {
      description: 'Checklist item dismissed'
    }
  }
});

// ─── Users ────────────────────────────────────────────────────────────────────

const PublicUser = registry.register(
  'PublicUser',
  z.object({
    id: z.number(),
    username: z.string(),
    avatar: z.string().nullable(),
    dateRegistered: z.string(),
    isArtist: z.boolean(),
    isDonor: z.boolean(),
    userRank: z.object({ name: z.string(), color: z.string() }),
    profile: z.object({
      id: z.number(),
      avatar: z.string().nullable().optional(),
      avatarMouseoverText: z.string().nullable().optional(),
      profileTitle: z.string().nullable().optional(),
      // Raw BBCode; `profileInfoHtml` is the render-time transcription (#398/#402).
      profileInfo: z.string().nullable().optional(),
      profileInfoHtml: z.string().optional()
    })
  })
);

const ProfileDetails = registry.register(
  'ProfileDetails',
  z.object({
    id: z.number(),
    avatar: z.string().nullable().optional(),
    avatarMouseoverText: z.string().nullable().optional(),
    profileTitle: z.string().nullable().optional(),
    // Raw BBCode; `profileInfoHtml` is the render-time transcription (#398/#402).
    profileInfo: z.string().nullable().optional(),
    profileInfoHtml: z.string().optional()
  })
);

const UserRankSummary = registry.register(
  'UserRankSummary',
  z.object({
    name: z.string(),
    color: z.string(),
    badge: z.string().optional(),
    displayStaff: z.boolean().optional()
  })
);

const UserSettings = registry.register(
  'UserSettings',
  z.object({
    id: z.number(),
    siteAppearance: z.string(),
    externalStylesheet: z.string().nullable().optional(),
    // Registry source pointer — the other arm of the Site Stylesheet radio
    // (ADR-0024 §4). Non-null ⇒ an adopted/authored sheet is active; mutually
    // exclusive with externalStylesheet.
    activeAuthorStylesheetId: z.number().nullable().optional(),
    styledTooltips: z.boolean(),
    paranoia: z.number(),
    notificationMethod: z.enum([
      'Disabled',
      'Popup',
      'Traditional',
      'Push',
      'Combined'
    ]),
    showEmail: z.boolean(),
    showLastSeen: z.boolean(),
    showContributedStats: z.boolean(),
    showConsumedStats: z.boolean(),
    showRatioStats: z.boolean(),
    // Whether [mature] BBCode renders its content for this viewer (#400).
    // Defaults TRUE: members opt OUT. A DISPLAY PREFERENCE, not an access
    // control -- see the note on `bodyHtml`.
    showMatureContent: z.boolean(),
    // Verified IRC nick (ADR-0015, #201) — self-only read path for the UI's
    // "currently linked: X" display. Non-null ⇒ verified; null ⇒ unlinked.
    ircNick: z.string().nullable().optional()
  })
);

const ProfileStats = registry.register(
  'ProfileStats',
  z.object({
    contributed: z.string().nullable(),
    consumed: z.string().nullable(),
    ratio: z.string().nullable(),
    buffer: z.string().nullable()
  })
);

const ProfileActivitySummary = registry.register(
  'ProfileActivitySummary',
  z.object({
    contributions: z.number(),
    requestsCreated: z.number(),
    requestsFilled: z.number(),
    forumTopics: z.number(),
    forumPosts: z.number(),
    comments: z.number(),
    collagesStarted: z.number(),
    collageEntries: z.number()
  })
);

const ProfileContribution = registry.register(
  'ProfileContribution',
  z.object({
    id: z.number(),
    createdAt: z.string(),
    release: z.object({
      id: z.number(),
      title: z.string(),
      communityId: z.number().nullable(),
      image: z.string().nullable(),
      artist: z
        .object({
          id: z.number(),
          name: z.string()
        })
        .nullable()
    })
  })
);

const ProfilePercentile = registry.register(
  'ProfilePercentile',
  z.object({
    percentile: z.number(),
    rank: z.number(),
    total: z.number(),
    raw: z.number().nullable()
  })
);

const ProfilePercentiles = registry.register(
  'ProfilePercentiles',
  z.object({
    contributed: ProfilePercentile,
    consumed: ProfilePercentile,
    contributions: ProfilePercentile,
    forumPosts: ProfilePercentile,
    requestsFilled: ProfilePercentile,
    artistsAdded: ProfilePercentile,
    overall: z.number()
  })
);

const ProfileCollageShelf = registry.register(
  'ProfileCollageShelf',
  z.object({
    id: z.number(),
    name: z.string(),
    categoryId: z.number(),
    isFeatured: z.boolean(),
    numEntries: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
    coverImages: z.array(z.string())
  })
);

const ProfileCollageShelves = registry.register(
  'ProfileCollageShelves',
  z.object({
    featuredPersonalCollages: z.array(ProfileCollageShelf),
    publicCollages: z.array(ProfileCollageShelf)
  })
);

const DonorPresentation = registry.register(
  'DonorPresentation',
  z.object({
    rank: z
      .object({
        name: z.string(),
        badge: z.string(),
        color: z.string(),
        grantedAt: z.string(),
        expiresAt: z.string().nullable()
      })
      .nullable(),
    customIcon: z.string().nullable(),
    customIconLink: z.string().nullable(),
    secondAvatar: z.string().nullable(),
    iconMouseOverText: z.string().nullable(),
    avatarMouseOverText: z.string().nullable(),
    profileBlocks: z.array(
      z.object({
        title: z.string(),
        body: z.string()
      })
    )
  })
);

const ProfileStaffPmSummary = registry.register(
  'ProfileStaffPmSummary',
  z.object({
    id: z.number(),
    subject: z.string(),
    status: z.enum(['Unanswered', 'Open', 'Resolved']),
    createdAt: z.string(),
    updatedAt: z.string(),
    assignedStaff: z
      .object({
        id: z.number(),
        username: z.string()
      })
      .nullable(),
    replyCount: z.number(),
    viewerCanOpen: z.boolean()
  })
);

const ProfileStaffPmOverview = registry.register(
  'ProfileStaffPmOverview',
  z.object({
    total: z.number(),
    unresolved: z.number(),
    recentConversations: z.array(ProfileStaffPmSummary)
  })
);

const ProfileSnatch = registry.register(
  'ProfileSnatch',
  z.object({
    id: z.number(),
    downloadedAt: z.string(),
    release: z.object({
      id: z.number(),
      title: z.string(),
      communityId: z.number().nullable()
    }),
    artist: z.object({ name: z.string() }).nullable()
  })
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const InviteNodeSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    id: z.number(),
    username: z.string(),
    email: z.string().email().optional(),
    joinedAt: z.string(),
    lastSeen: z.string().nullable().optional(),
    contributed: z.string().optional(),
    consumed: z.string().optional(),
    ratio: z.string().optional(),
    children: z.array(InviteNodeSchema).optional()
  })
);

const InviteNode = registry.register('InviteNode', InviteNodeSchema);

// PRD-01 Profile Integration: community-stats block. Null when the target's
// paranoia hides all stats from this viewer; the reputation `ratio` dimension is
// omitted (and the score recomputed) when consumed stats are hidden.
const CommunityStats = registry.register(
  'CommunityStats',
  z.object({
    friends: z.number(),
    invites: z.object({
      direct: z.number(),
      total: z.number(),
      depth: z.number()
    }),
    reputation: z.object({
      score: z.number(),
      dimensions: z.array(
        z.object({
          name: z.string(),
          subScore: z.number(),
          weighted: z.number()
        })
      )
    })
  })
);

const PublicProfile = registry.register(
  'PublicProfile',
  z.object({
    id: z.number(),
    username: z.string(),
    avatar: z.string().nullable(),
    email: z.string().email().nullable(),
    dateRegistered: z.string(),
    lastSeen: z.string().nullable(),
    isArtist: z.boolean(),
    isDonor: z.boolean(),
    disabled: z.boolean(),
    warned: z.string().nullable(),
    standing: z.enum(['pristine', 'clean', 'neutral', 'poor', 'hammer']),
    inviteCount: z.number().nullable(),
    staffBio: z.string().nullable(),
    stats: ProfileStats,
    userRank: UserRankSummary.extend({
      id: z.number()
    }),
    profile: ProfileDetails,
    activitySummary: ProfileActivitySummary,
    percentiles: ProfilePercentiles,
    donorPresentation: DonorPresentation.nullable(),
    collageShelves: ProfileCollageShelves,
    staffPmOverview: ProfileStaffPmOverview.nullable(),
    recentContributions: z.array(ProfileContribution),
    recentSnatches: z.array(ProfileSnatch),
    inviteTree: z.array(InviteNode),
    community: CommunityStats.nullable()
  })
);

const MyProfile = registry.register(
  'MyProfile',
  z.object({
    ...PublicProfile.shape,
    userSettings: UserSettings
  })
);

const AdminCreatedUser = registry.register(
  'AdminCreatedUser',
  z.object({
    id: z.number(),
    username: z.string(),
    email: z.string().email()
  })
);

// ─── korin.pink inbound (ADR-0013 / ADR-0015) ────────────────────────────────
//
// Three routes in this file are gated by `requireServiceKey` — a Bearer service
// key that fails closed — and NOT by a member session. They exist for the IRC
// bridge to call; no browser client should ever reach them.
//
// They used to carry NO security block at all, and the reasoning here was
// right: declaring `bearerAuth` "would describe the wrong credential", because
// that name was being used across 70 cookie-gated routes. The fix was to name
// the scheme for what it is rather than to say nothing — these now derive
// `serviceKey`, and they are the only three that do (#520).

const IrcNickAccount = registry.register(
  'IrcNickAccount',
  z.object({
    id: z.number().int(),
    username: z.string(),
    ircNick: z.string().nullable()
  })
);

const IrcNickVerifyResult = registry.register(
  'IrcNickVerifyResult',
  z.object({
    verified: z.boolean(),
    // Present on failure only; the bot relays it back to the member over IRC.
    reason: z.string().optional()
  })
);

const SnatchItem = registry.register(
  'SnatchItem',
  z.object({
    id: z.number().int(),
    release: z.object({
      id: z.number().int(),
      title: z.string(),
      communityId: z.number().int().nullable()
    }),
    artist: z.object({ name: z.string() }).nullable(),
    downloadedAt: z.string()
  })
);

const DuplicateIpGroup = registry.register(
  'DuplicateIpGroup',
  z.object({
    ip: z.string(),
    count: z.number().int(),
    users: z.array(
      z.object({
        id: z.number().int(),
        username: z.string(),
        dateRegistered: z.string(),
        disabled: z.boolean(),
        lastLogin: z.string().nullable()
      })
    )
  })
);

const RegistrationLogEntry = registry.register(
  'RegistrationLogEntry',
  z.object({
    id: z.number().int(),
    username: z.string(),
    email: z.string(),
    dateRegistered: z.string(),
    disabled: z.boolean(),
    lastIp: z.string().nullable(),
    userRank: z.object({ id: z.number().int(), name: z.string() })
  })
);

const UserRankState = registry.register(
  'UserRankState',
  z.object({
    userRankId: z.number().int(),
    secondaryRankIds: z.array(z.number().int()),
    rankLocked: z.boolean()
  })
);

registry.registerPath({
  method: 'get',
  path: '/users/by-irc-nick/{nick}',
  tags: ['Users'],
  summary: 'korin: resolve a verified IRC nick to its account',
  description:
    'Service-key route (ADR-0013), not a member route — authenticate with the ' +
    'korin service key, not a session. A disabled account answers 404 exactly ' +
    'as an unknown nick does, so the endpoint does not reveal that a ' +
    'suspended member exists.',
  request: { params: z.object({ nick: z.string() }) },
  responses: {
    200: {
      description: 'The linked account',
      content: { 'application/json': { schema: IrcNickAccount } }
    },
    404: msgResponse(
      'No account linked to that nick, or the account is disabled'
    )
  }
});

registry.registerPath({
  method: 'post',
  path: '/users/irc-nick/verify',
  tags: ['Users'],
  summary: 'korin: complete an IRC nick verification',
  description:
    'Service-key route (ADR-0015). korin relays the authenticated IRC sender ' +
    'nick and the code it received over a private query. **Always answers ' +
    '200** — a failed verification is a `{ verified: false, reason }` RESULT ' +
    'the bot relays back over IRC, not an HTTP error, so do not treat a ' +
    'non-2xx as the failure path here.',
  request: {
    body: { content: { 'application/json': { schema: ircNickVerifySchema } } }
  },
  responses: {
    200: {
      description: 'Verification result, successful or not',
      content: { 'application/json': { schema: IrcNickVerifyResult } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/users/duplicate-ips',
  tags: ['Users'],
  summary: 'Staff: accounts sharing a last-seen IP',
  description:
    'Requires `duplicate_ips_view`. Groups only IPs seen on more than one ' +
    'account, busiest first.',
  responses: {
    200: {
      description: 'Shared-IP groups',
      content: {
        'application/json': { schema: z.array(DuplicateIpGroup) }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/users/registration-log',
  tags: ['Users'],
  summary: 'Staff: accounts by registration date',
  description:
    'Requires `registration_log_view` — its own permission, separate from ' +
    '`duplicate_ips_view`. Newest first. Includes email and last IP, so it is ' +
    'a more sensitive read than the ordinary user list.',
  responses: {
    200: {
      description: 'Paginated registrations',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(RegistrationLogEntry),
            meta: PaginationMeta
          })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/users/{id}/email-history',
  tags: ['Users'],
  summary: 'Staff: a user past email addresses',
  description:
    'Requires `users_view_email`. The stored column is `newEmail`; it is ' +
    'returned as `email`. Newest change first.',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Email history',
      content: {
        'application/json': {
          schema: z.array(
            z.object({ email: z.string(), changedAt: z.string() })
          )
        }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/users/{id}/ip-history',
  tags: ['Users'],
  summary: 'Staff: a user IP history',
  description:
    'Requires `users_view_ips` — a different permission from ' +
    '`users_view_email`, so the two histories are separately grantable.',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'IP history',
      content: {
        'application/json': {
          schema: z.array(z.object({ ip: z.string(), seenAt: z.string() }))
        }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/users/{id}/rank',
  tags: ['Users'],
  summary: 'Staff: a user rank, secondary ranks and lock state',
  description:
    'Requires `users_edit`. The canonical staff read of `rankLocked` — the ' +
    'admin rank panel initialises its toggle from here.',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Rank state',
      content: { 'application/json': { schema: UserRankState } }
    },
    404: msgResponse('User not found')
  }
});

registry.registerPath({
  method: 'put',
  path: '/users/{id}/rank',
  tags: ['Users'],
  summary: 'Staff: set a user rank',
  description:
    'Requires `users_edit`. **`secondaryRankIds` REPLACES the whole secondary ' +
    'set** — send the full list, not a delta, or you will strip a Donor/VIP ' +
    'secondary. That is exactly why rank-lock is its own route ' +
    '(PUT /users/{id}/rank-lock) rather than a field here. Answers 200 with a ' +
    'message rather than the new rank state; re-read GET /users/{id}/rank for ' +
    'that.',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: setRankSchema } } }
  },
  responses: {
    200: msgResponse('Rank updated'),
    404: msgResponse('User or rank not found')
  }
});

registry.registerPath({
  method: 'get',
  path: '/users/{id}/snatch-list',
  tags: ['Users'],
  summary: 'Staff: what a user has downloaded',
  description: 'Requires `staff`.',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Snatch list',
      content: { 'application/json': { schema: z.array(SnatchItem) } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/users/me/snatch-list',
  tags: ['Users'],
  summary: 'What you have downloaded',
  description:
    'Self only, and needs no permission — the same shape the staff route ' +
    'returns for someone else.',
  responses: {
    200: {
      description: 'Your snatch list',
      content: { 'application/json': { schema: z.array(SnatchItem) } }
    }
  }
});

const DonorRank = registry.register(
  'DonorRank',
  z.object({
    id: z.number().int(),
    name: z.string(),
    minDonation: z.number(),
    expiresAfterDays: z.number().int().nullable(),
    // Json column: a flat map of perk key to whether the rank grants it.
    perks: z.record(z.string(), z.boolean()),
    // Both default at the DB rather than being nullable — `badge` to a heart
    // glyph, `color` to an empty string.
    color: z.string(),
    badge: z.string()
  })
);

registry.registerPath({
  method: 'get',
  path: '/users/donor-ranks',
  tags: ['Users'],
  summary: 'The donor rank ladder',
  description:
    'Readable by any authenticated member — this is the only donor route ' +
    'that does NOT require `donor_ranks_manage`, because the perks are ' +
    'member-facing. Ordered by `minDonation`, cheapest first.',
  responses: {
    200: {
      description: 'Donor ranks',
      content: { 'application/json': { schema: z.array(DonorRank) } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/users/donor-ranks',
  tags: ['Users'],
  summary: 'Create a donor rank',
  description: 'Requires `donor_ranks_manage`.',
  request: {
    body: { content: { 'application/json': { schema: donorRankSchema } } }
  },
  responses: {
    201: {
      description: 'Donor rank created',
      content: { 'application/json': { schema: DonorRank } }
    },
    409: msgResponse('A donor rank with that name already exists')
  }
});

registry.registerPath({
  method: 'put',
  path: '/users/donor-ranks/{rankId}',
  tags: ['Users'],
  summary: 'Replace a donor rank',
  description:
    'Requires `donor_ranks_manage`. **A full replace, not a partial patch** — ' +
    'it validates against the same schema as create, so any optional field ' +
    'you omit is written as its default rather than left as it was.',
  request: {
    params: z.object({ rankId: z.string() }),
    body: { content: { 'application/json': { schema: donorRankSchema } } }
  },
  responses: {
    200: {
      description: 'Updated donor rank',
      content: { 'application/json': { schema: DonorRank } }
    },
    404: msgResponse('Donor rank not found'),
    409: msgResponse('A donor rank with that name already exists')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/users/donor-ranks/{rankId}',
  tags: ['Users'],
  summary: 'Delete a donor rank',
  description: 'Requires `donor_ranks_manage`.',
  request: { params: z.object({ rankId: z.string() }) },
  responses: {
    204: {
      description: 'Donor rank deleted'
    },
    404: msgResponse('Donor rank not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/users/{id}/donor',
  tags: ['Users'],
  summary: 'Grant donor status to a user',
  description:
    'Requires `donor_ranks_manage`. Omit `expiresAt` for a grant that does ' +
    'not lapse. `donorExpiryJob` sweeps expired grants hourly and is ' +
    'condition-based, so a later staff re-grant survives the sweep. Answers ' +
    '**201 with a message rather than the granted row** — unusual for a 201, ' +
    'but that is what ships.',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: grantDonorSchema } } }
  },
  responses: {
    201: msgResponse('Donor status granted'),
    404: msgResponse('User or donor rank not found')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/users/{id}/donor',
  tags: ['Users'],
  summary: 'Revoke a user donor status',
  description:
    'Requires `donor_ranks_manage`. Removes **every** donor-rank grant on ' +
    'that user, not just the most recent, and clears the `isDonor` flag.',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: {
      description: 'Donor status revoked'
    },
    404: msgResponse('User not found')
  }
});

// Moderation reads include the acting staff member; the CREATE responses return
// the freshly-made row without that relation, so `warnedBy`/`author` are
// optional rather than required.
const UserWarning = registry.register(
  'UserWarning',
  z.object({
    id: z.number().int(),
    userId: z.number().int(),
    warnedById: z.number().int(),
    reason: z.string(),
    expiresAt: z.string().nullable(),
    createdAt: z.string(),
    warnedBy: z
      .object({ id: z.number().int(), username: z.string() })
      .optional()
  })
);

const UserModerationNote = registry.register(
  'UserModerationNote',
  z.object({
    id: z.number().int(),
    userId: z.number().int(),
    authorId: z.number().int(),
    body: z.string(),
    createdAt: z.string(),
    author: z.object({ id: z.number().int(), username: z.string() }).optional()
  })
);

registry.registerPath({
  method: 'get',
  path: '/users/{id}/warnings',
  tags: ['Users'],
  summary: 'Warnings on a user',
  description:
    'Requires `users_warn`. Newest first, each carrying the staff member who ' +
    'issued it.',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Warnings',
      content: { 'application/json': { schema: z.array(UserWarning) } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/users/{id}/warn',
  tags: ['Users'],
  summary: 'Warn a user',
  description:
    'Requires `users_warn`. Beyond creating the row this **increments the ' +
    "user's `warnedTimes` and stamps `warned`**, which is what the Standing " +
    'tier (PRD-05/ADR-0004) reads — so a warning is a reputation event, not ' +
    'just a note. Omit `expiresAt` for a warning that does not lapse. The ' +
    'response wraps the new row as `{ warning }` and does not include ' +
    '`warnedBy`.',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: warnUserSchema } } }
  },
  responses: {
    201: {
      description: 'Warning issued',
      content: {
        'application/json': { schema: z.object({ warning: UserWarning }) }
      }
    },
    404: msgResponse('User not found')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/users/{id}/warnings/{warnId}',
  tags: ['Users'],
  summary: 'Rescind a warning',
  description: 'Requires `users_warn`.',
  request: {
    params: z.object({ id: z.string(), warnId: z.string() })
  },
  responses: {
    204: {
      description: 'Warning removed'
    },
    404: msgResponse('Warning not found on that user')
  }
});

registry.registerPath({
  method: 'get',
  path: '/users/{id}/notes',
  tags: ['Users'],
  summary: 'Staff moderation notes on a user',
  description:
    'Requires `users_edit` — a DIFFERENT permission from the warnings above, ' +
    'so a moderator who can warn cannot necessarily read notes. Newest first, ' +
    'each carrying its author.',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Moderation notes',
      content: {
        'application/json': { schema: z.array(UserModerationNote) }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/users/{id}/notes',
  tags: ['Users'],
  summary: 'Add a moderation note to a user',
  description:
    'Requires `users_edit`. Unlike a warning this is staff-internal and has ' +
    "no effect on the member's standing. The response wraps the new row as " +
    '`{ note }` and does not include `author`.',
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { 'application/json': { schema: moderationNoteSchema } }
    }
  },
  responses: {
    201: {
      description: 'Note added',
      content: {
        'application/json': {
          schema: z.object({ note: UserModerationNote })
        }
      }
    },
    404: msgResponse('User not found')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/users/{id}/notes/{noteId}',
  tags: ['Users'],
  summary: 'Delete a moderation note',
  description: 'Requires `users_edit`.',
  request: {
    params: z.object({ id: z.string(), noteId: z.string() })
  },
  responses: {
    204: {
      description: 'Note deleted'
    },
    404: msgResponse('That note does not exist on that user')
  }
});

registry.registerPath({
  method: 'post',
  path: '/users/{id}/disable',
  tags: ['Users'],
  summary: 'Disable a user account',
  description:
    'Requires `users_disable` — a third permission, distinct from both ' +
    '`users_warn` and `users_edit`. This is the SOFT delete: it sets ' +
    '`disabled: true`, it does not remove the row, and the action is written ' +
    'to the audit log. Answers **200 with a message, not 204**.',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: msgResponse('User disabled'),
    404: msgResponse('User not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/users/{id}/enable',
  tags: ['Users'],
  summary: 'Re-enable a disabled user account',
  description:
    'Requires `users_disable`, the same permission that disables. Audited. ' +
    'Answers **200 with a message, not 204**.',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: msgResponse('User enabled'),
    404: msgResponse('User not found')
  }
});

registry.registerPath({
  method: 'get',
  path: '/users/{id}',
  tags: ['Users'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'User profile',
      content: { 'application/json': { schema: PublicUser } }
    },
    404: msgResponse('Not found')
  }
});

// IRC nick link (ADR-0015) — the user-facing claim. Setting a nick issues a
// Verification Code the member must prove from that nick on IRC; it does not
// bind the nick. The companion POST /users/irc-nick/verify is a korin
// service-key inbound call and, like the other korin endpoints
// (/users/{id}/reputation, by-irc-nick), is intentionally kept out of the
// public contract.
const IrcNickClaimBody = z.object({
  ircNick: z
    .string()
    .max(30)
    .regex(
      /^[a-zA-Z_\-[\]\\^{}|`][a-zA-Z0-9_\-[\]\\^{}|`]*$/,
      'Invalid IRC nick'
    )
    .nullable()
});

const IrcNickLinkResult = registry.register(
  'IrcNickLinkResult',
  z.object({
    msg: z.string(),
    ircNick: z.string().nullable().optional(),
    code: z.string().optional(),
    expiresAt: z.string().datetime().optional(),
    instructions: z.string().optional()
  })
);

registry.registerPath({
  method: 'put',
  path: '/users/{id}/irc-nick',
  tags: ['Users'],
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: IrcNickClaimBody } } }
  },
  responses: {
    200: {
      description:
        'Nick claim opened (returns the verification code + instructions), nick cleared, or already verified',
      content: { 'application/json': { schema: IrcNickLinkResult } }
    },
    403: msgResponse('Not self or admin'),
    409: msgResponse('Nick already verified by another account')
  }
});

registry.registerPath({
  method: 'put',
  path: '/users/{id}/rank-lock',
  tags: ['Users'],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: rankLockSchema
        }
      }
    }
  },
  responses: {
    200: msgResponse(
      'Rank lock toggled (freezes/unfreezes auto class-progression)'
    ),
    404: msgResponse('User not found')
  }
});

registry.registerPath({
  method: 'get',
  path: '/users/settings',
  tags: ['Users'],
  responses: {
    200: {
      description: 'Current user settings',
      content: { 'application/json': { schema: UserSettings } }
    },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'put',
  path: '/users/settings',
  tags: ['Users'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: userSettingsSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: 'Updated current user settings',
      content: {
        'application/json': {
          schema: UserSettings.extend({
            avatar: z.string().optional()
          })
        }
      }
    },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/users',
  tags: ['Users'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: adminCreateUserSchema
        }
      }
    }
  },
  responses: {
    201: {
      description: 'Created user',
      content: {
        'application/json': {
          schema: AdminCreatedUser
        }
      }
    },
    400: msgResponse('User already exists')
  }
});

// ─── Staff recovery queue ─────────────────────────────────────────────────────

const RecoveryRequestItem = registry.register(
  'RecoveryRequestItem',
  z.object({
    id: z.number(),
    userId: z.number(),
    username: z.string(),
    email: z.string(),
    status: z.enum(['pending', 'used', 'expired']),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    usedAt: z.string().datetime().nullable()
  })
);

registry.registerPath({
  method: 'get',
  path: '/users/recovery-requests',
  tags: ['Users'],
  request: {
    query: z.object({
      status: z.enum(['pending', 'used', 'expired']).optional(),
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().optional()
    })
  },
  responses: {
    200: {
      description: 'Paginated list of account recovery requests',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(RecoveryRequestItem),
            meta: PaginationMeta
          })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'delete',
  path: '/users/recovery-requests/{reqId}',
  tags: ['Users'],
  request: { params: z.object({ reqId: z.string() }) },
  responses: {
    200: msgResponse('Recovery request revoked'),
    404: msgResponse('Not found'),
    409: msgResponse('Token already used')
  }
});

const UserWarningItem = registry.register(
  'UserWarningItem',
  z.object({
    id: z.number(),
    userId: z.number(),
    user: StaffUserRef,
    reason: z.string(),
    expiresAt: z.string().nullable(),
    createdAt: z.string(),
    warnedBy: StaffUserRef.nullable()
  })
);

registry.registerPath({
  method: 'get',
  path: '/users/warnings',
  tags: ['Users'],
  request: {
    query: z.object({
      page: z.string().optional(),
      userId: z.string().optional()
    })
  },
  responses: {
    200: {
      description: 'Paginated staff warning log',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(UserWarningItem),
            meta: PaginationMeta
          })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/users/{id}/recovery',
  tags: ['Users'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: msgResponse('Recovery email sent'),
    404: msgResponse('User not found'),
    502: msgResponse('Email delivery not configured')
  }
});

// ─── Profile ──────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/profile/me',
  tags: ['Profile'],
  responses: {
    200: {
      description: 'Current user profile',
      content: { 'application/json': { schema: MyProfile } }
    },
    404: msgResponse('Profile not found')
  }
});

// A captured CRS read in the trend series (#94). The score stays computed on
// read; this is the snapshot read-model only. The korin service surface
// (/users/{id}/reputation/history) is intentionally kept out of the public
// contract, like its sibling /users/{id}/reputation.
const CrsSnapshot = z
  .object({
    capturedAt: z.string(),
    period: z.enum(['Monthly', 'Yearly']),
    score: z.number(),
    dimensions: z.array(
      z.object({
        name: z.string(),
        subScore: z.number(),
        weighted: z.number()
      })
    )
  })
  .openapi('CrsSnapshot');

registry.registerPath({
  method: 'get',
  path: '/profile/me/reputation/history',
  summary: 'Community Reputation Score over time (own trend series)',
  tags: ['Profile'],
  request: {
    // CRS is captured only daily/weekly (it moves on a multi-day scale), so the
    // series offers Monthly and Yearly periods — Daily is rejected.
    query: z.object({ period: z.enum(['Monthly', 'Yearly']) })
  },
  responses: {
    200: {
      description: 'CRS snapshot history (ascending by capturedAt)',
      content: { 'application/json': { schema: z.array(CrsSnapshot) } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/profile/user/{userId}',
  tags: ['Profile'],
  request: { params: z.object({ userId: z.string() }) },
  responses: {
    200: {
      description: 'Public profile',
      content: { 'application/json': { schema: PublicProfile } }
    },
    404: msgResponse('Profile not found')
  }
});

registry.registerPath({
  method: 'put',
  path: '/profile/me',
  tags: ['Profile'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: profileUpdateSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: 'Updated current user profile',
      content: { 'application/json': { schema: MyProfile } }
    },
    404: msgResponse('Profile not found')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/profile',
  tags: ['Profile'],
  responses: {
    204: {
      description: 'Account disabled'
    }
  }
});

const ProfileSummary = registry.register(
  'ProfileSummary',
  z.object({
    id: z.number().int(),
    username: z.string(),
    avatar: z.string().nullable(),
    profile: z.object({ profileTitle: z.string().nullable() }).nullable()
  })
);

registry.registerPath({
  method: 'get',
  path: '/profile',
  tags: ['Profile'],
  summary: 'List every active profile',
  description:
    'Active (non-disabled) users only, as a flat array. Deliberately not ' +
    'paginated, unlike most list endpoints.',
  responses: {
    200: {
      description: 'Active profiles',
      content: { 'application/json': { schema: z.array(ProfileSummary) } }
    }
  }
});

const CrsDimension = registry.register(
  'CrsDimension',
  z.object({
    name: z.string(),
    subScore: z.number(),
    weighted: z.number()
  })
);

const CrsView = registry.register(
  'CrsView',
  z.object({
    score: z.number(),
    dimensions: z.array(CrsDimension),
    suspect: z.boolean()
  })
);

// GET /users/{id}/reputation is registered HERE rather than up in the Users
// block because it returns CrsView, and these consts evaluate in file order.
// Kept adjacent to the member-facing /profile/me/reputation on purpose: the two
// share a shape and differ only in exposure, and seeing them together is the
// point.
registry.registerPath({
  method: 'get',
  path: '/users/{id}/reputation',
  tags: ['Users'],
  summary: 'korin: the full, unfiltered Community Reputation Score',
  description:
    'Service-key route, and **the unfiltered view** — unlike ' +
    'GET /profile/me/reputation, which strips the moderation-only dimensions ' +
    'and therefore always reports `suspect: false`. The two share a JSON ' +
    'shape and differ in exposure: this one carries the invite-tree Contagion ' +
    'signal and a MEANINGFUL `suspect` flag, which ADR-0004 section 3 requires ' +
    'be kept from members so a sockpuppet ring is not tipped off. Do not bind ' +
    'a member-facing UI to this route. Whether CRS is member-facing at all is ' +
    'still open (#429); registering this documents what ships and settles ' +
    'nothing.',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Unfiltered reputation, including the moderation signal',
      content: { 'application/json': { schema: CrsView } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/profile/me/reputation',
  tags: ['Profile'],
  summary: 'Community Reputation Score for the authenticated member',
  description:
    'Self-view (ADR-0004 section 3): snatch-derived dimensions are included, ' +
    'moderation-only ones are not, and `suspect` is therefore always false ' +
    'here. `score` is recomputed from the visible dimensions, so a gated ' +
    'viewer cannot back a hidden dimension out of the total.',
  responses: {
    200: {
      description: 'Reputation',
      content: { 'application/json': { schema: CrsView } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/profile/referral/create-invite',
  tags: ['Profile'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: inviteSchema
        }
      }
    }
  },
  responses: {
    201: {
      description: 'Invite created',
      content: {
        'application/json': {
          schema: z.object({
            inviteKey: z.string(),
            emailSent: z.boolean()
          })
        }
      }
    },
    403: msgResponse('No invites remaining'),
    409: msgResponse('Invite already exists')
  }
});

// ─── Donor rewards (self-service) ────────────────────────────────────────────

const DonorRewardsSchema = registry.register(
  'DonorRewards',
  z.object({
    rewards: z.object({
      iconMouseOverText: z.string(),
      avatarMouseOverText: z.string(),
      customIcon: z.string(),
      customIconLink: z.string(),
      secondAvatar: z.string(),
      profileInfoTitle1: z.string(),
      profileInfo1: z.string(),
      profileInfoTitle2: z.string(),
      profileInfo2: z.string(),
      profileInfoTitle3: z.string(),
      profileInfo3: z.string(),
      profileInfoTitle4: z.string(),
      profileInfo4: z.string()
    }),
    perks: z.record(z.string(), z.boolean()),
    forumTitle: z
      .object({
        prefix: z.string(),
        suffix: z.string(),
        useComma: z.boolean()
      })
      .nullable()
  })
);

const DonorForumTitleSchema = registry.register(
  'DonorForumTitle',
  z.object({
    prefix: z.string(),
    suffix: z.string(),
    useComma: z.boolean()
  })
);

registry.registerPath({
  method: 'get',
  path: '/profile/me/donor-rewards',
  tags: ['Profile'],
  responses: {
    200: {
      description: 'Donor reward settings and active perks',
      content: { 'application/json': { schema: DonorRewardsSchema } }
    },
    404: msgResponse('No active donor rank')
  }
});

registry.registerPath({
  method: 'put',
  path: '/profile/me/donor-rewards',
  tags: ['Profile'],
  request: {
    body: {
      content: { 'application/json': { schema: donorRewardUpdateSchema } }
    }
  },
  responses: {
    200: {
      description: 'Updated donor reward settings',
      content: { 'application/json': { schema: DonorRewardsSchema } }
    },
    403: msgResponse('No active donor rank')
  }
});

registry.registerPath({
  method: 'put',
  path: '/profile/me/donor-title',
  tags: ['Profile'],
  request: {
    body: {
      content: { 'application/json': { schema: donorForumTitleUpdateSchema } }
    }
  },
  responses: {
    200: {
      description: 'Updated forum title',
      content: { 'application/json': { schema: DonorForumTitleSchema } }
    },
    403: msgResponse('Perk not enabled for this rank')
  }
});

// ─── Home ─────────────────────────────────────────────────────────────────────

const HomepageFeaturedRelease = registry.register(
  'HomepageFeaturedRelease',
  z.object({
    id: z.number(),
    title: z.string(),
    year: z.number().nullable().optional(),
    image: z.string().nullable().optional(),
    communityId: z.number(),
    artist: z
      .object({
        id: z.number(),
        name: z.string()
      })
      .nullable()
      .optional()
  })
);

const HomepageFeaturedAlbum = registry.register(
  'HomepageFeaturedAlbum',
  z.object({
    id: z.number(),
    title: z.string(),
    started: z.string(),
    ended: z.string(),
    threadId: z.number().nullable().optional(),
    release: HomepageFeaturedRelease
  })
);

registry.registerPath({
  method: 'get',
  path: '/home/featured',
  tags: ['Home'],
  responses: {
    200: {
      description: 'Homepage featured content',
      content: {
        'application/json': {
          schema: z.object({
            albumOfTheMonth: HomepageFeaturedAlbum.nullable(),
            vanityHouse: HomepageFeaturedRelease.nullable()
          })
        }
      }
    }
  }
});

// ─── Announcements ────────────────────────────────────────────────────────────

const Announcement = registry.register(
  'Announcement',
  z.object({
    id: z.number(),
    title: z.string(),
    body: z.string(),
    createdAt: z.string()
  })
);

const BlogPost = registry.register(
  'BlogPost',
  z.object({
    id: z.number(),
    title: z.string(),
    body: z.string().optional(),
    createdAt: z.string(),
    user: z
      .object({
        username: z.string(),
        avatar: z.string().nullable().optional()
      })
      .optional()
  })
);

const AnnouncementsResponse = registry.register(
  'AnnouncementsResponse',
  z.object({
    announcements: z.array(Announcement),
    blogPosts: z.array(BlogPost)
  })
);

const SiteStats = registry.register(
  'SiteStats',
  z.object({
    // getSystemStats() reads the SiteSettings row and returns maxUsers first —
    // it is a capacity figure alongside the counts, not part of them.
    maxUsers: z.number(),
    totalUsers: z.number(),
    enabledUsers: z.number(),
    activeToday: z.number(),
    activeThisWeek: z.number(),
    activeThisMonth: z.number(),
    communities: z.number(),
    releases: z.number(),
    artists: z.number(),
    blogPosts: z.number(),
    announcements: z.number(),
    comments: z.number(),
    contributedLinks: z.number(),
    contributedLinkDownloads: z.number()
  })
);

const SiteStatSnapshot = registry.register(
  'SiteStatSnapshot',
  z.object({
    id: z.number(),
    // getSiteStatHistory() returns raw rows, so the bucket key is on every one.
    // It is the `@unique` column the hourly/daily capture upserts against —
    // distinct from capturedAt, which is when the row was written.
    bucketAt: z.string(),
    capturedAt: z.string(),
    maxUsers: z.number(),
    totalUsers: z.number(),
    enabledUsers: z.number(),
    activeToday: z.number(),
    activeThisWeek: z.number(),
    activeThisMonth: z.number(),
    communities: z.number(),
    releases: z.number(),
    artists: z.number(),
    blogPosts: z.number(),
    announcements: z.number(),
    comments: z.number(),
    contributedLinks: z.number(),
    contributedLinkDownloads: z.number()
  })
);

const UserStatSnapshot = registry.register(
  'UserStatSnapshot',
  z.object({
    id: z.number(),
    userId: z.number(),
    period: z.enum(['Daily', 'Monthly', 'Yearly']),
    capturedAt: z.string(),
    contributed: z.string().nullable(),
    consumed: z.string().nullable(),
    contributionCount: z.number()
  })
);

const Notification = registry.register(
  'Notification',
  z.object({
    id: z.number(),
    // The handler returns `{ ...n, source }` off a findMany with no `select`,
    // so every column is on the wire — userId included, and it was missing.
    userId: z.number(),
    type: z.nativeEnum(NotificationType),
    actorId: z.number().nullable().optional(),
    actor: z
      .object({
        id: z.number(),
        username: z.string(),
        avatar: z.string().nullable().optional()
      })
      .nullable()
      .optional(),
    page: z.nativeEnum(SubscriptionPage),
    pageId: z.number(),
    postId: z.number().nullable().optional(),
    readAt: z.string().nullable().optional(),
    createdAt: z.string(),
    // One shape per `page` branch of the enrichment loop, flattened: `title` is
    // the only field every branch sets. `forumId` comes from the forums branch,
    // `releaseId`/`communityId` from contributions and release, and `url` from
    // global_notices — which was missing, and is read by the UI's notice banner.
    source: z
      .object({
        title: z.string(),
        forumId: z.number().optional(),
        releaseId: z.number().optional(),
        communityId: z.number().optional(),
        url: z.string().optional()
      })
      .nullable()
      .optional()
  })
);

const Subscription = registry.register(
  'Subscription',
  z.object({
    id: z.number(),
    topicId: z.number()
  })
);

const VersionResponse = registry.register(
  'VersionResponse',
  z.object({ version: z.string() })
);

const Stylesheet = registry.register(
  'Stylesheet',
  z.object({
    id: z.number(),
    name: z.string(),
    description: z.string(),
    // null = no delivery target: the row is in the picker and renders nothing
    // (Sublime). Clients must branch on null rather than on the name (#371).
    cssUrl: z.string().nullable(),
    isDefault: z.boolean(),
    createdAt: z.string()
  })
);

const StylesheetStat = registry.register(
  'StylesheetStat',
  z.object({
    id: z.number(),
    name: z.string(),
    userCount: z.number()
  })
);

// PRD-03 #118/#119/#120 — a user-authored stylesheet. `source` is the raw
// CSS/SCSS (sanitized at store-time, ADR-0003), not a URL.
const AuthorStylesheet = registry.register(
  'AuthorStylesheet',
  z.object({
    id: z.number(),
    authorId: z.number(),
    name: z.string(),
    source: z.string(),
    createdAt: z.string(),
    updatedAt: z.string()
  })
);

// The list projection (#146) never carries `source` (ADR-0024 §1) — the full
// body is fetched only via the single-sheet read / `/css` delivery route.
const AuthorStylesheetListItem = registry.register(
  'AuthorStylesheetListItem',
  z.object({
    id: z.number(),
    authorId: z.number(),
    name: z.string(),
    createdAt: z.string(),
    updatedAt: z.string()
  })
);

// Result of adopting an author stylesheet into the Site Stylesheet slot (#119):
// the adopted sheet plus whether this adoption recorded a new CRS event (#120).
const AdoptionResult = registry.register(
  'AdoptionResult',
  z.object({
    authorStylesheet: AuthorStylesheet,
    scored: z.boolean()
  })
);

registry.registerPath({
  method: 'get',
  path: '/version',
  tags: ['Meta'],
  responses: {
    200: {
      description: 'The running platform version',
      content: { 'application/json': { schema: VersionResponse } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/announcements',
  tags: ['Announcements'],
  responses: {
    200: {
      description: 'News and blog posts',
      content: {
        'application/json': { schema: AnnouncementsResponse }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/announcements',
  tags: ['Announcements'],
  request: {
    body: {
      content: { 'application/json': { schema: announcementSchema } }
    }
  },
  responses: {
    201: {
      description: 'Announcement created',
      content: { 'application/json': { schema: Announcement } }
    }
  }
});

registry.registerPath({
  method: 'put',
  path: '/announcements/{id}',
  tags: ['Announcements'],
  summary: 'Staff: update a news item',
  description:
    'Requires the `news_manage` permission. Title and body are passed through ' +
    '`sanitizePlain`, so markup in either is stripped rather than stored.',
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { 'application/json': { schema: announcementSchema } }
    }
  },
  responses: {
    200: {
      description: 'Updated news item',
      content: { 'application/json': { schema: Announcement } }
    },
    404: msgResponse('No announcement with that id')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/announcements/{id}',
  tags: ['Announcements'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: {
      description: 'Announcement deleted'
    },
    404: msgResponse('No announcement with that id')
  }
});

registry.registerPath({
  method: 'post',
  path: '/announcements/blog',
  tags: ['Announcements'],
  request: {
    body: {
      content: { 'application/json': { schema: announcementSchema } }
    }
  },
  responses: {
    201: {
      description: 'Blog post created',
      content: { 'application/json': { schema: BlogPost } }
    }
  }
});

registry.registerPath({
  method: 'delete',
  path: '/announcements/blog/{id}',
  tags: ['Announcements'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: {
      description: 'Blog post deleted'
    },
    404: msgResponse('No blog post with that id')
  }
});

const GlobalNotice = registry.register(
  'GlobalNotice',
  z.object({
    id: z.number(),
    message: z.string(),
    url: z.string().nullable(),
    expiresAt: z.string().nullable(),
    createdAt: z.string(),
    createdBy: StaffUserRef
  })
);

registry.registerPath({
  method: 'get',
  path: '/announcements/global-notices',
  tags: ['Announcements'],
  responses: {
    200: {
      description: 'All global notices',
      content: {
        'application/json': { schema: z.array(GlobalNotice) }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/announcements/global-notice',
  tags: ['Announcements'],
  request: {
    body: {
      content: { 'application/json': { schema: globalNoticeSchema } }
    }
  },
  responses: {
    201: {
      description: 'Global notice created',
      content: { 'application/json': { schema: GlobalNotice } }
    }
  }
});

registry.registerPath({
  method: 'delete',
  path: '/announcements/global-notice/{id}',
  tags: ['Announcements'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Notice deleted' },
    404: msgResponse('No global notice with that id')
  }
});

registry.registerPath({
  method: 'get',
  path: '/stats',
  tags: ['Stats'],
  responses: {
    200: {
      description: 'Site statistics',
      content: { 'application/json': { schema: SiteStats } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/stats/history',
  summary: 'Site-wide historical stat snapshots',
  tags: ['Stats'],
  responses: {
    200: {
      description: 'Historical site stat snapshots (ascending by capturedAt)',
      content: { 'application/json': { schema: z.array(SiteStatSnapshot) } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/stats/snapshot',
  summary: 'Manually trigger a site stat snapshot (admin only)',
  tags: ['Stats'],
  responses: {
    204: { description: 'Snapshot captured' }
  }
});

registry.registerPath({
  method: 'get',
  path: '/users/{id}/stats/history',
  summary: 'User historical stat snapshots',
  tags: ['Users'],
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({ period: z.enum(['Daily', 'Monthly', 'Yearly']) })
  },
  responses: {
    200: {
      description: 'Historical user stat snapshots (ascending by capturedAt)',
      content: { 'application/json': { schema: z.array(UserStatSnapshot) } }
    },
    403: {
      description: 'Stats are private',
      content: { 'application/json': { schema: z.object({ msg: z.string() }) } }
    },
    404: {
      description: 'User not found',
      content: { 'application/json': { schema: z.object({ msg: z.string() }) } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/stylesheet/author',
  tags: ['Stylesheets'],
  request: {
    body: {
      content: { 'application/json': { schema: authorStylesheetSchema } }
    }
  },
  description:
    'Two further conditions answer 400 beyond body validation, and the ' +
    "declared schema shows only the validator's. Exceeding the caller's " +
    'rank quota answers `{ msg }`; CSS that violates the ADR-0031 boundary ' +
    'answers `{ errors: { source: [...] } }`, one entry per violation with ' +
    'its location — the same envelope a validation failure uses.',
  responses: {
    201: {
      description: 'Author stylesheet created',
      content: { 'application/json': { schema: AuthorStylesheet } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/stylesheet/author/{userId}',
  tags: ['Stylesheets'],
  request: {
    params: z.object({ userId: z.string() }),
    query: z.object({
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().optional()
    })
  },
  responses: {
    200: {
      description: "An author's stylesheets, paginated (#146)",
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(AuthorStylesheetListItem),
            meta: PaginationMeta
          })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/stylesheet/author-stylesheet/{id}',
  tags: ['Stylesheets'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Author stylesheet',
      content: { 'application/json': { schema: AuthorStylesheet } }
    },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'put',
  path: '/stylesheet/author-stylesheet/{id}',
  tags: ['Stylesheets'],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { 'application/json': { schema: authorStylesheetSchema } }
    }
  },
  responses: {
    200: {
      description: 'Author stylesheet updated; edits propagate to adopters',
      content: { 'application/json': { schema: AuthorStylesheet } }
    },
    403: msgResponse('Not your stylesheet'),
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/stylesheet/author-stylesheet/{id}',
  tags: ['Stylesheets'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: {
      description: 'Author stylesheet withdrawn (soft); adopters keep rendering'
    },
    403: msgResponse('Not your stylesheet'),
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/stylesheet/author-stylesheet/{id}/adopt',
  tags: ['Stylesheets'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Stylesheet adopted into the Site Stylesheet slot',
      content: { 'application/json': { schema: AdoptionResult } }
    },
    404: msgResponse('Not found')
  }
});

// The registry sheet's CSS delivery route (ADR-0024 §1) — the injector links
// this exactly as Personal links an external URL. Body is text/css, not JSON.
registry.registerPath({
  method: 'get',
  path: '/stylesheet/author-stylesheet/{id}/css',
  tags: ['Stylesheets'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'The stored, sanitized stylesheet source as CSS',
      content: { 'text/css': { schema: z.string() } }
    },
    404: msgResponse('Not found')
  }
});

// Content-addressed binary delivery (ADR-0026). Addressed by sha256 rather than
// row id. Site-shipped assets (ownerId null) serve unauthenticated; member
// uploads require auth — the tier is derived from ownership. Body is the raw asset.
registry.registerPath({
  method: 'get',
  path: '/asset/{hash}',
  tags: ['Assets'],
  request: { params: z.object({ hash: z.string() }) },
  responses: {
    200: {
      description:
        'The stored asset bytes, with the mime verified at ingest and immutable caching',
      content: { 'application/octet-stream': { schema: z.string() } }
    },
    400: msgResponse(
      'Malformed content address (not a 64-char lowercase sha256)'
    ),
    401: msgResponse('A member-uploaded asset fetched without authentication'),
    404: msgResponse('Not found')
  }
});

const AssetUploadResponse = registry.register(
  'AssetUploadResponse',
  z.object({
    hash: z.string(),
    url: z.string(),
    mime: z.string(),
    size: z.number(),
    kind: z.nativeEnum(AssetKind)
  })
);

// Authenticated, quota-gated upload (ADR-0026 Phase 2, #342). The body is the
// raw image, identified by magic bytes; the declared Content-Type is checked
// against them, never trusted. Only images (fonts stay seeder-only, #343).
registry.registerPath({
  method: 'post',
  path: '/asset',
  tags: ['Assets'],
  request: {
    body: {
      content: { 'application/octet-stream': { schema: z.string() } }
    }
  },
  responses: {
    201: {
      description: 'The stored asset address',
      content: { 'application/json': { schema: AssetUploadResponse } }
    },
    400: msgResponse(
      'Empty, oversize, non-image, or misdeclared payload, or the rank asset limit is reached (or zero)'
    )
  }
});

registry.registerPath({
  method: 'get',
  path: '/stylesheet',
  tags: ['Stylesheets'],
  responses: {
    200: {
      description: 'Available stylesheets',
      content: { 'application/json': { schema: z.array(Stylesheet) } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/stylesheet/admin/stats',
  tags: ['Stylesheets'],
  responses: {
    200: {
      description: 'Stylesheet user counts (admin only)',
      content: { 'application/json': { schema: z.array(StylesheetStat) } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/stylesheet/{id}',
  tags: ['Stylesheets'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Stylesheet',
      content: { 'application/json': { schema: Stylesheet } }
    },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/stylesheet',
  tags: ['Stylesheets'],
  request: {
    body: { content: { 'application/json': { schema: stylesheetSchema } } }
  },
  description:
    'A `cssUrl` naming a `/css` delivery target that does not resolve to an ' +
    'existing authored stylesheet answers 400 with `{ msg }`, beyond the ' +
    'body validation the declared schema covers.',
  responses: {
    201: {
      description: 'Stylesheet created',
      content: { 'application/json': { schema: Stylesheet } }
    }
  }
});

registry.registerPath({
  method: 'put',
  path: '/stylesheet/{id}',
  tags: ['Stylesheets'],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { 'application/json': { schema: stylesheetUpdateSchema } }
    }
  },
  responses: {
    200: {
      description: 'Stylesheet updated',
      content: { 'application/json': { schema: Stylesheet } }
    },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/stylesheet/{id}',
  tags: ['Stylesheets'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: {
      description: 'Stylesheet removed'
    },
    400: msgResponse('Cannot delete the default stylesheet'),
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'get',
  path: '/notifications',
  tags: ['Notifications'],
  responses: {
    200: {
      description: 'Notifications',
      content: {
        'application/json': { schema: z.array(Notification) }
      }
    }
  }
});

registry.registerPath({
  method: 'delete',
  path: '/notifications/{id}',
  tags: ['Notifications'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: {
      description: 'Notification removed'
    },
    403: msgResponse('Not the recipient'),
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'get',
  path: '/notifications/unread-count',
  tags: ['Notifications'],
  summary: 'How many notifications the caller has not read',
  responses: {
    200: {
      description: 'Unread count',
      content: {
        'application/json': { schema: z.object({ count: z.number().int() }) }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/notifications/read-all',
  tags: ['Notifications'],
  summary: 'Mark every unread notification as read',
  responses: {
    204: {
      description: 'All notifications marked read'
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/notifications/{id}/read',
  tags: ['Notifications'],
  summary: 'Mark one notification as read',
  description:
    'Idempotent: re-reading an already-read notification is a no-op.',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: {
      description: 'Notification marked read'
    },
    403: msgResponse('Not the recipient'),
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'get',
  path: '/subscriptions',
  tags: ['Subscriptions'],
  responses: {
    200: {
      description: 'Forum subscriptions',
      content: {
        'application/json': { schema: z.array(Subscription) }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/subscriptions/subscribe',
  tags: ['Subscriptions'],
  request: {
    body: { content: { 'application/json': { schema: subscribeSchema } } }
  },
  responses: {
    204: {
      description: 'Subscription updated'
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/subscriptions/subscribe-comments',
  tags: ['Subscriptions'],
  request: {
    body: {
      content: { 'application/json': { schema: subscribeCommentsSchema } }
    }
  },
  responses: {
    204: {
      description: 'Comment subscription updated'
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/subscriptions/comment-status',
  tags: ['Subscriptions'],
  request: {
    query: subscribeCommentsSchema.omit({ action: true })
  },
  responses: {
    200: {
      description: 'Comment subscription status',
      content: {
        'application/json': {
          schema: z.object({ subscribed: z.boolean() })
        }
      }
    }
  }
});

// ─── Forums ───────────────────────────────────────────────────────────────────

const Forum = registry.register(
  'Forum',
  z.object({
    id: z.number(),
    sort: z.number(),
    name: z.string(),
    description: z.string(),
    minClassRead: z.number().optional(),
    minClassWrite: z.number().optional(),
    minClassCreate: z.number().optional(),
    numTopics: z.number(),
    numPosts: z.number(),
    forumCategory: z
      .object({
        id: z.number(),
        name: z.string()
      })
      .optional(),
    lastTopic: z
      .object({
        id: z.number(),
        title: z.string()
      })
      .optional()
  })
);

const ForumCategory = registry.register(
  'ForumCategory',
  z.object({
    id: z.number(),
    name: z.string(),
    sort: z.number(),
    forums: z.array(Forum).optional()
  })
);

const ForumTopic = registry.register(
  'ForumTopic',
  z.object({
    id: z.number(),
    title: z.string(),
    forumId: z.number(),
    authorId: z.number(),
    isLocked: z.boolean(),
    isSticky: z.boolean(),
    numPosts: z.number(),
    author: AuthorRef.optional(),
    lastPost: z
      .object({
        id: z.number(),
        createdAt: z.string(),
        author: AuthorRef.optional()
      })
      .nullable()
      .optional(),
    createdAt: z.string(),
    updatedAt: z.string()
  })
);

const ForumPostEdit = registry.register(
  'ForumPostEdit',
  z.object({
    id: z.number(),
    forumPostId: z.number(),
    editorId: z.number(),
    previousBody: z.string(),
    editedAt: z.string(),
    editor: z.object({ id: z.number(), username: z.string() }).optional()
  })
);

const ForumPostLastEdit = registry.register(
  'ForumPostLastEdit',
  z.object({
    id: z.number(),
    forumPostId: z.number(),
    editorId: z.number(),
    editedAt: z.string(),
    editor: z.object({ id: z.number(), username: z.string() }).optional()
  })
);

const ForumPost = registry.register(
  'ForumPost',
  z.object({
    id: z.number(),
    forumTopicId: z.number(),
    authorId: z.number(),
    // Raw BBCode; `bodyHtml` is the render-time transcription (#402).
    //
    // `bodyHtml` is VIEWER-DEPENDENT since #400: a `[mature]` block renders its
    // content only when the reader's `showMatureContent` is true, and is replaced
    // by a fixed notice otherwise. `body` is NOT filtered -- it still carries the
    // raw source so the editor round-trips -- so this is a display preference, not
    // an access control. Never cache a response carrying `bodyHtml` across viewers.
    body: z.string(),
    bodyHtml: z.string().optional(),
    lastEdit: ForumPostLastEdit.optional(),
    author: AuthorRef.optional(),
    createdAt: z.string(),
    updatedAt: z.string()
  })
);

const ForumPollVote = registry.register(
  'ForumPollVote',
  z.object({
    id: z.number(),
    forumPollId: z.number(),
    userId: z.number(),
    vote: z.number()
  })
);

const ForumPoll = registry.register(
  'ForumPoll',
  z.object({
    id: z.number(),
    forumTopicId: z.number(),
    question: z.string(),
    answers: z.string(),
    featured: z.string().datetime().nullable().optional(),
    closed: z.boolean(),
    votes: z.array(ForumPollVote)
  })
);

const ForumLastReadTopic = registry.register(
  'ForumLastReadTopic',
  z.object({
    id: z.number(),
    userId: z.number(),
    forumTopicId: z.number(),
    forumPostId: z.number()
  })
);

const PaginatedForumTopics = registry.register(
  'PaginatedForumTopics',
  z.object({
    data: z.array(ForumTopic),
    meta: PaginationMeta
  })
);

const ForumTopicSessionAffordances = z.object({
  canReply: z.boolean(),
  canModerate: z.boolean(),
  canVoteInPoll: z.boolean(),
  canSubscribe: z.boolean(),
  canCatchUp: z.boolean()
});

const ForumTopicSession = registry.register(
  'ForumTopicSession',
  z.object({
    forum: z.object({
      id: z.number(),
      name: z.string(),
      forumCategoryId: z.number(),
      forumCategory: z
        .object({ id: z.number(), name: z.string() })
        .nullable()
        .optional()
    }),
    topic: ForumTopic,
    posts: z.object({
      data: z.array(ForumPost),
      meta: PaginationMeta
    }),
    poll: ForumPoll.nullable().optional(),
    subscription: z.object({ isSubscribed: z.boolean() }),
    affordances: ForumTopicSessionAffordances,
    readState: z.object({ lastVisiblePostId: z.number().nullable() })
  })
);

registry.registerPath({
  method: 'get',
  path: '/forums/categories',
  tags: ['Forums'],
  description:
    'Categories the caller may read, each with its readable forums. ' +
    '`?all=true` skips both the class filter and the empty-category filter ' +
    'and is checked in the handler, not by a gate — hence the 403 no ' +
    'middleware declares.',
  responses: {
    200: {
      description: 'All categories with forums',
      content: {
        'application/json': { schema: z.array(ForumCategory) }
      }
    },
    403: msgResponse(
      '?all=true without forums_manage, rank_permissions_manage or admin'
    )
  }
});

registry.registerPath({
  method: 'post',
  path: '/forums/categories',
  tags: ['Forums'],
  request: {
    body: {
      content: { 'application/json': { schema: createForumCategorySchema } }
    }
  },
  responses: {
    201: {
      description: 'Category created',
      content: { 'application/json': { schema: ForumCategory } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/forums/categories/{id}',
  tags: ['Forums'],
  summary: 'One forum category with its forums',
  description:
    'Forums are ordered by `sort` and carry `lastTopic`. The list is filtered ' +
    'to what the caller may read (`minClassRead`), so two members can get ' +
    'different forums back for the same category.',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Category with its readable forums',
      content: { 'application/json': { schema: ForumCategory } }
    },
    404: msgResponse('Category not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/forums/{id}/catchup',
  tags: ['Forums'],
  summary: 'Mark every topic in a forum as read',
  description:
    'Returns how many topics were marked. Only topics with a last post are ' +
    'counted, so `markedRead` can legitimately be 0 for an empty forum.',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Topics marked read',
      content: {
        'application/json': {
          schema: z.object({ markedRead: z.number().int() })
        }
      }
    },
    403: msgResponse('Insufficient class for this forum'),
    404: msgResponse('Forum not found')
  }
});

registry.registerPath({
  method: 'put',
  path: '/forums/categories/{id}',
  tags: ['Forums'],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { 'application/json': { schema: updateForumCategorySchema } }
    }
  },
  responses: {
    200: {
      description: 'Category updated',
      content: { 'application/json': { schema: ForumCategory } }
    },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/forums/categories/{id}',
  tags: ['Forums'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Category deleted' },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'get',
  path: '/forums',
  tags: ['Forums'],
  responses: {
    200: {
      description: 'Forums',
      content: { 'application/json': { schema: z.array(Forum) } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/forums/{id}',
  tags: ['Forums'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Forum',
      content: { 'application/json': { schema: Forum } }
    },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/forums',
  tags: ['Forums'],
  request: {
    body: { content: { 'application/json': { schema: createForumSchema } } }
  },
  responses: {
    201: {
      description: 'Forum created',
      content: { 'application/json': { schema: Forum } }
    }
  }
});

registry.registerPath({
  method: 'put',
  path: '/forums/{id}',
  tags: ['Forums'],
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: updateForumSchema } } }
  },
  responses: {
    200: {
      description: 'Forum updated',
      content: { 'application/json': { schema: Forum } }
    },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/forums/{id}',
  tags: ['Forums'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Forum deleted' },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'get',
  path: '/forums/{forumId}/topics',
  tags: ['Forums'],
  request: {
    params: z.object({ forumId: z.string() }),
    query: z.object({ page: z.string().optional() })
  },
  responses: {
    200: {
      description: 'Paginated topics',
      content: { 'application/json': { schema: PaginatedForumTopics } }
    },
    403: msgResponse('Insufficient class to read this forum'),
    404: msgResponse('Forum not found')
  }
});

registry.registerPath({
  method: 'get',
  path: '/forums/{forumId}/topics/{topicId}/session',
  tags: ['Forums'],
  request: {
    params: z.object({ forumId: z.string(), topicId: z.string() }),
    query: z.object({ page: z.string().optional() })
  },
  responses: {
    200: {
      description:
        'Topic session view model (forum + topic + posts + poll + subscription + affordances)',
      content: { 'application/json': { schema: ForumTopicSession } }
    },
    403: msgResponse('Insufficient class'),
    404: msgResponse('Forum or topic not found')
  }
});

registry.registerPath({
  method: 'get',
  path: '/forums/{forumId}/topics/{topicId}',
  tags: ['Forums'],
  request: {
    params: z.object({ forumId: z.string(), topicId: z.string() })
  },
  responses: {
    200: {
      description: 'Topic',
      content: { 'application/json': { schema: ForumTopic } }
    },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/forums/{forumId}/topics',
  tags: ['Forums'],
  request: {
    params: z.object({ forumId: z.string() }),
    body: {
      content: { 'application/json': { schema: createTopicSchema } }
    }
  },
  responses: {
    201: {
      description: 'Topic created',
      content: { 'application/json': { schema: ForumTopic } }
    },
    403: msgResponse('Insufficient class to create topics in this forum'),
    404: msgResponse('Forum not found')
  }
});

registry.registerPath({
  method: 'put',
  path: '/forums/{forumId}/topics/{topicId}',
  tags: ['Forums'],
  request: {
    params: z.object({ forumId: z.string(), topicId: z.string() }),
    body: { content: { 'application/json': { schema: updateTopicSchema } } }
  },
  responses: {
    200: {
      description: 'Topic updated',
      content: { 'application/json': { schema: ForumTopic } }
    },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/forums/{forumId}/topics/{topicId}',
  tags: ['Forums'],
  request: {
    params: z.object({ forumId: z.string(), topicId: z.string() })
  },
  responses: {
    204: {
      description: 'Topic removed'
    },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/forums/{forumId}/topics/{topicId}/trash',
  tags: ['Forums'],
  request: {
    params: z.object({ forumId: z.string(), topicId: z.string() })
  },
  responses: {
    200: {
      description: 'Topic moved to the trash board',
      content: { 'application/json': { schema: ForumTopic } }
    },
    403: msgResponse('Not authorized'),
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'get',
  path: '/forums/{forumId}/topics/{topicId}/posts',
  tags: ['Forums'],
  request: {
    params: z.object({ forumId: z.string(), topicId: z.string() }),
    query: z.object({ page: z.string().optional() })
  },
  responses: {
    200: {
      description: 'Paginated posts',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(ForumPost),
            meta: PaginationMeta
          })
        }
      }
    },
    403: msgResponse('Insufficient class to read this forum'),
    404: msgResponse('Forum not found')
  }
});

registry.registerPath({
  method: 'get',
  path: '/forums/{forumId}/topics/{topicId}/posts/{id}',
  tags: ['Forums'],
  request: {
    params: z.object({
      forumId: z.string(),
      topicId: z.string(),
      id: z.string()
    })
  },
  responses: {
    200: {
      description: 'Post',
      content: { 'application/json': { schema: ForumPost } }
    },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'get',
  path: '/forums/{forumId}/topics/{topicId}/posts/{id}/edits',
  tags: ['Forums'],
  request: {
    params: z.object({
      forumId: z.string(),
      topicId: z.string(),
      id: z.string()
    })
  },
  responses: {
    200: {
      description: 'Moderator edit history',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(ForumPostEdit)
          })
        }
      }
    },
    403: msgResponse('Insufficient permission'),
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/forums/{forumId}/topics/{topicId}/posts',
  tags: ['Forums'],
  request: {
    params: z.object({ forumId: z.string(), topicId: z.string() }),
    body: { content: { 'application/json': { schema: createPostSchema } } }
  },
  responses: {
    201: {
      description: 'Post created',
      content: { 'application/json': { schema: ForumPost } }
    },
    403: msgResponse('Topic locked')
  }
});

registry.registerPath({
  method: 'put',
  path: '/forums/{forumId}/topics/{topicId}/posts/{id}',
  tags: ['Forums'],
  request: {
    params: z.object({
      forumId: z.string(),
      topicId: z.string(),
      id: z.string()
    }),
    body: { content: { 'application/json': { schema: updatePostSchema } } }
  },
  responses: {
    200: {
      description: 'Post updated',
      content: { 'application/json': { schema: ForumPost } }
    },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/forums/{forumId}/topics/{topicId}/posts/{id}',
  tags: ['Forums'],
  request: {
    params: z.object({
      forumId: z.string(),
      topicId: z.string(),
      id: z.string()
    })
  },
  responses: {
    204: {
      description: 'Post removed'
    },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'get',
  path: '/forums/polls/{topicId}',
  tags: ['Forums'],
  request: { params: z.object({ topicId: z.string() }) },
  responses: {
    200: {
      description: 'Poll',
      content: { 'application/json': { schema: ForumPoll } }
    },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/forums/polls',
  tags: ['Forums'],
  request: {
    body: { content: { 'application/json': { schema: pollSchema } } }
  },
  responses: {
    201: {
      description: 'Poll created',
      content: { 'application/json': { schema: ForumPoll } }
    },
    403: msgResponse('Not the topic author, and missing forums_moderate'),
    404: msgResponse('No such topic, or it is deleted')
  }
});

registry.registerPath({
  method: 'put',
  path: '/forums/polls/{id}/close',
  tags: ['Forums'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Poll closed',
      content: { 'application/json': { schema: ForumPoll } }
    },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/forums/poll-votes',
  tags: ['Forums'],
  request: {
    body: { content: { 'application/json': { schema: pollVoteSchema } } }
  },
  responses: {
    200: {
      description: 'Vote recorded',
      content: { 'application/json': { schema: ForumPollVote } }
    },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'get',
  path: '/forums/last-read',
  tags: ['Forums'],
  responses: {
    200: {
      description: 'Last-read markers',
      content: {
        'application/json': { schema: z.array(ForumLastReadTopic) }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/forums/last-read',
  tags: ['Forums'],
  request: {
    body: { content: { 'application/json': { schema: lastReadSchema } } }
  },
  responses: {
    200: {
      description: 'Last-read marker saved',
      content: { 'application/json': { schema: ForumLastReadTopic } }
    },
    403: msgResponse('Insufficient class to read this forum'),
    404: msgResponse('No such post in that topic, or either is deleted')
  }
});

// ─── Communities ──────────────────────────────────────────────────────────────

const CommunityCurator = registry.register(
  'CommunityCurator',
  z.object({
    id: z.number(),
    username: z.string()
  })
);

// A community's membership is the role union, not its consumer list (ADR-0033):
// `roles` is why a curator who has never downloaded still appears in the roster.
const CommunityMember = registry.register(
  'CommunityMember',
  z.object({
    id: z.number(),
    username: z.string(),
    roles: z.array(z.enum(['consumer', 'contributor', 'curator', 'leader']))
  })
);

const Community = registry.register(
  'Community',
  z.object({
    id: z.number(),
    name: z.string(),
    description: z.string().nullable().optional(),
    type: z.nativeEnum(CommunityType),
    registrationStatus: z.nativeEnum(RegistrationStatus),
    // Announce routing only — never an access gate (ADR-0030, ADR-0015).
    announceVisibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
    image: z.string().nullable().optional(),
    allowDuplicateFormats: z.boolean(),
    leaderId: z.number().nullable().optional(),
    curators: z.array(CommunityCurator).optional(),
    // Detail view only — the browse list keeps cheap relation counts instead.
    members: z.array(CommunityMember).optional(),
    _count: z
      .object({
        releases: z.number(),
        contributors: z.number(),
        consumers: z.number()
      })
      .optional()
  })
);

const ReleaseTag = registry.register(
  'ReleaseTag',
  z.object({
    id: z.number(),
    name: z.string()
  })
);

const ReleaseArtist = registry.register(
  'ReleaseArtist',
  z.object({
    id: z.number(),
    name: z.string()
  })
);

const ReleaseContribution = registry.register(
  'ReleaseContribution',
  z.object({
    id: z.number(),
    user: z.object({
      id: z.number(),
      username: z.string()
    }),
    type: z.nativeEnum(FileType),
    downloadUrl: z.string(),
    sizeInBytes: z.number().nullable().optional(),
    collaborators: z.array(
      z.object({
        id: z.number(),
        name: z.string(),
        vanityHouse: z.boolean().optional()
      })
    ),
    releaseDescription: z.string().nullable().optional()
  })
);

const Contribution = registry.register(
  'Contribution',
  z.object({
    id: z.number(),
    user: z.object({
      id: z.number(),
      username: z.string()
    }),
    release: z.object({
      id: z.number(),
      title: z.string(),
      communityId: z.number().nullable().optional()
    }),
    type: z.nativeEnum(FileType),
    downloadUrl: z.string(),
    sizeInBytes: z.number().nullable().optional(),
    linkStatus: z.enum(['UNKNOWN', 'PASS', 'WARN', 'FAIL']),
    linkCheckedAt: z.string().nullable().optional(),
    ratioExempt: z.enum(['NONE', 'FREEPASS', 'NEUTRALPASS']),
    collaborators: z.array(
      z.object({
        id: z.number(),
        name: z.string()
      })
    ),
    releaseDescription: z.string().nullable().optional(),
    createdAt: z.string().optional()
  })
);

// The per-file rip-quality satellite (ReleaseFile), nested on a release-scoped
// contribution read. `bitrate` is null until graded.
const ReleaseFileQuality = registry.register(
  'ReleaseFileQuality',
  z.object({
    bitrate: z
      .enum([
        'Lossless',
        'Lossless24',
        'Kbps320',
        'Kbps256',
        'KbpsV0',
        'Kbps192',
        'KbpsV2',
        'Kbps128',
        'Other'
      ])
      .nullable(),
    hasLog: z.boolean(),
    hasCue: z.boolean(),
    isScene: z.boolean()
  })
);

// The Edition identity (per-pressing) nested on a release-scoped contribution
// read — media plus the fields that compose the edition string.
const EditionIdentity = registry.register(
  'EditionIdentity',
  z.object({
    id: z.number(),
    media: z
      .enum([
        'CD',
        'WEB',
        'Vinyl',
        'SACD',
        'DVD',
        'Cassette',
        'BluRay',
        'DAT',
        'Soundboard',
        'Other'
      ])
      .nullable(),
    year: z.number().nullable(),
    recordLabel: z.string().nullable(),
    catalogueNumber: z.string().nullable(),
    title: z.string().nullable(),
    isRemaster: z.boolean(),
    isUnknownEdition: z.boolean()
  })
);

// A release-scoped contribution carrying the rip-quality satellite + edition
// identity (issue #129) — the shape the release detail view omits.
const ReleaseContributionDetail = registry.register(
  'ReleaseContributionDetail',
  z.object({
    id: z.number(),
    userId: z.number(),
    releaseId: z.number(),
    contributorId: z.number(),
    releaseDescription: z.string().nullable().optional(),
    downloadUrl: z.string(),
    sizeInBytes: z.number().nullable(),
    linkStatus: z.enum(['UNKNOWN', 'PASS', 'WARN', 'FAIL']).nullable(),
    linkCheckedAt: z.string().nullable(),
    ratioExempt: z.enum(['NONE', 'FREEPASS', 'NEUTRALPASS']),
    type: z.nativeEnum(FileType),
    createdAt: z.string(),
    updatedAt: z.string(),
    user: z.object({ id: z.number(), username: z.string() }).nullable(),
    collaborators: z.array(z.object({ id: z.number(), name: z.string() })),
    releaseFile: ReleaseFileQuality.nullable(),
    edition: EditionIdentity
  })
);

const ReleaseTagEnriched = registry.register(
  'ReleaseTagEnriched',
  z.object({
    id: z.number(),
    tagId: z.number(),
    name: z.string(),
    occurrences: z.number(),
    score: z.number(),
    positiveVotes: z.number(),
    negativeVotes: z.number(),
    addedBy: z
      .object({ id: z.number(), username: z.string() })
      .nullable()
      .optional(),
    createdAt: z.string().nullable().optional(),
    myVotes: z.object({ up: z.boolean(), down: z.boolean() }).optional()
  })
);

const ReleaseSnapshot = registry.register(
  'ReleaseSnapshot',
  z.object({
    title: z.string(),
    description: z.string(),
    image: z.string().nullable(),
    year: z.number(),
    tagIds: z.array(z.number()),
    tagNames: z.array(z.string())
  })
);

const ReleaseHistoryEntry = registry.register(
  'ReleaseHistoryEntry',
  z.object({
    id: z.number(),
    action: z.enum([
      'created',
      'edit',
      'tag_added',
      'tag_removed',
      'contribution_added'
    ]),
    summary: z.string(),
    changedFields: z.array(z.string()),
    before: z.record(z.string(), z.unknown()).nullable().optional(),
    after: z.record(z.string(), z.unknown()).nullable().optional(),
    snapshot: ReleaseSnapshot.nullable().optional(),
    createdAt: z.string(),
    actor: z.object({ id: z.number(), username: z.string() })
  })
);

// `Release.releaseType` is a `ReleaseCategory` column, not free text, and every
// projection that returns a release selects it — so it is a required, non-null
// enum everywhere it appears. It had been `z.string()` at five sites with THREE
// different nullabilities between them (nullable+optional, optional, required),
// which told clients the field might be absent, might be null, and could hold
// any string. All three were wrong: the column is `ReleaseCategory` NOT NULL.
//
// Sourced from the Prisma enum rather than a literal `z.enum([...])` so it
// cannot drift from the fourteen values the database actually accepts.
// The community health pulse band. NOT a Prisma enum — computePulse()
// (modules/linkHealth.ts) derives it, and its return type is the closed union
// spelled out here. `Unknown` is the deliberate low-confidence answer, not a
// missing value: too few checked links to band honestly.
const HealthPulseStatus = z.enum(['Healthy', 'Ailing', 'Critical', 'Unknown']);

const ReleaseCategoryEnum = z.nativeEnum(ReleaseCategory);

// `Release.type` and `Request.type` are the SAME `ReleaseType` column — the
// medium a release is (Music, EBooks, Comics, …), distinct from
// `releaseType`/`ReleaseCategory` above, which is the edition kind (Album,
// Single, Live, …). The two sit next to each other on every release-shaped
// response and both had been `z.string()`, which is a large part of why they
// are easy to confuse.
//
// Same story as ReleaseCategory: six sites, three different nullabilities, a
// NOT NULL column that every projection selects.
//
// NOT applied to `Contribution.type` (a `FileType` — mp3/flac/…) or
// `Community.type` (a `CommunityType`). Those are different enums with the
// identical stringly-typed bug, and want their own change.
const ReleaseTypeEnum = z.nativeEnum(ReleaseType);

const Release = registry.register(
  'Release',
  z.object({
    id: z.number(),
    title: z.string(),
    communityId: z.number().nullable(),
    year: z.number().nullable().optional(),
    type: ReleaseTypeEnum,
    releaseType: ReleaseCategoryEnum,
    image: z.string().nullable().optional(),
    // Raw BBCode; `descriptionHtml` is the render-time transcription (#402).
    description: z.string().nullable().optional(),
    descriptionHtml: z.string().optional(),
    createdAt: z.string().optional(),
    artist: ReleaseArtist.nullable().optional(),
    tags: z.array(ReleaseTag).optional(),
    releaseTags: z.array(ReleaseTagEnriched).optional(),
    myVote: z.enum(['up', 'down']).nullable().optional(),
    voteAggregate: z
      .object({
        ups: z.number(),
        total: z.number(),
        score: z.number()
      })
      .nullable()
      .optional(),
    contributions: z.array(ReleaseContribution).optional(),
    isContributor: z.boolean().optional()
  })
);

// ─── Permission catalog ───────────────────────────────────────────────────────

const PermissionKey = registry.register(
  'PermissionKey',
  z.enum(VALID_PERMISSIONS)
);

const PermissionEntry = registry.register(
  'PermissionEntry',
  z.object({
    key: PermissionKey,
    label: z.string(),
    description: z.string()
  })
);

registry.register(
  'PermissionGroup',
  z.object({
    key: z.string(),
    title: z.string(),
    permissions: z.array(PermissionEntry)
  })
);

// ─────────────────────────────────────────────────────────────────────────────

// All four /tools/user-ranks routes project `formatRank` (routes/api/tools.ts),
// which builds the object field by field and always emits every one of them —
// so nothing here is optional, and the four that used to be absent entirely
// (`secondary`, `permittedForumIds`, and the two per-relation user counts) are
// on the wire like the rest. `secondary` and `permittedForumIds` are live reads
// in stellar-ui's rank manager, rank form and profile rank pickers.
//
// Only `assetLimit` and `staffGroupId` are nullable, and both because the
// column is (`Int?`) — for assetLimit null means UNCAPPED, not absent (#342).
const UserRank = registry.register(
  'UserRank',
  z.object({
    id: z.number(),
    name: z.string(),
    level: z.number(),
    // normalizePermissions() always returns a map, empty at worst — never null.
    permissions: z.record(z.string(), z.boolean()),
    secondary: z.boolean(),
    permittedForumIds: z.array(z.number().int()),
    color: z.string(),
    badge: z.string(),
    personalCollageLimit: z.number().int(),
    authorStylesheetLimit: z.number().int(),
    assetLimit: z.number().int().nullable(),
    displayStaff: z.boolean(),
    staffGroupId: z.number().int().nullable(),
    primaryUserCount: z.number().int(),
    secondaryUserCount: z.number().int(),
    userCount: z.number()
  })
);

const StaffGroup = registry.register(
  'StaffGroup',
  z.object({
    id: z.number(),
    name: z.string(),
    sortOrder: z.number(),
    rankCount: z.number().optional()
  })
);

const StaffMember = registry.register(
  'StaffMember',
  z.object({
    userId: z.number(),
    username: z.string(),
    rankName: z.string(),
    rankColor: z.string(),
    lastSeen: z.string().nullable(),
    // Raw BBCode; `staffBioHtml` is the render-time transcription (#402).
    staffBio: z.string().nullable(),
    staffBioHtml: z.string().optional()
  })
);

const StaffGroupWithMembers = registry.register(
  'StaffGroupWithMembers',
  z.object({
    id: z.number().nullable(),
    name: z.string(),
    sortOrder: z.number(),
    members: z.array(StaffMember)
  })
);

registry.registerPath({
  method: 'get',
  path: '/communities',
  tags: ['Communities'],
  responses: {
    200: {
      description: 'Paginated communities',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(Community),
            meta: PaginationMeta
          })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/communities/{id}',
  tags: ['Communities'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Community',
      content: { 'application/json': { schema: Community } }
    },
    404: msgResponse('Not found')
  }
});

const CommunityHealthPulse = z
  .object({
    pass: z.number(),
    warn: z.number(),
    fail: z.number(),
    unknown: z.number(),
    total: z.number(),
    checked: z.number(),
    coverage: z.number().nullable(),
    pulse: z.number().nullable(),
    status: z.enum(['Healthy', 'Ailing', 'Critical', 'Unknown'])
  })
  .openapi('CommunityHealthPulse');

registry.registerPath({
  method: 'get',
  path: '/communities/{id}/health',
  tags: ['Communities'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Community link-health pulse',
      content: { 'application/json': { schema: CommunityHealthPulse } }
    },
    403: msgResponse('Not a member of this community'),
    404: msgResponse('Not found')
  }
});

const CommunityHealthSnapshot = z
  .object({
    id: z.number(),
    communityId: z.number(),
    period: z.enum(['Daily', 'Monthly', 'Yearly']),
    bucketAt: z.string(),
    capturedAt: z.string(),
    pass: z.number(),
    warn: z.number(),
    fail: z.number(),
    unknown: z.number(),
    total: z.number(),
    checked: z.number(),
    coverage: z.number().nullable(),
    pulse: z.number().nullable(),
    status: HealthPulseStatus
  })
  .openapi('CommunityHealthSnapshot');

registry.registerPath({
  method: 'get',
  path: '/communities/{id}/health/history',
  tags: ['Communities'],
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({
      period: z.enum(['Daily', 'Monthly', 'Yearly']).optional()
    })
  },
  responses: {
    200: {
      description: 'Community link-health pulse history (time series)',
      content: {
        'application/json': { schema: z.array(CommunityHealthSnapshot) }
      }
    },
    403: msgResponse('Not a member of this community'),
    404: msgResponse('Not found')
  }
});

// `{communityId}`, not `{id}`: the route mounts this router at
// `/:communityId/releases`, and the sibling POST on this very path was already
// registered as `{communityId}`. The `{id}` spelling made one operation of a
// two-operation path disagree with both the code and its own sibling.
registry.registerPath({
  method: 'get',
  path: '/communities/{communityId}/releases',
  tags: ['Communities'],
  request: { params: z.object({ communityId: z.string() }) },
  responses: {
    200: {
      description: 'Releases for community',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(Release),
            meta: PaginationMeta
          })
        }
      }
    },
    403: msgResponse('Not a member of this community'),
    404: msgResponse('Community not found')
  }
});

const CommunityVoteState = registry.register(
  'CommunityVoteState',
  z.object({
    // Not an integer: the workbench returns the direction it just applied —
    // `positive ? 'up' : 'down'` on POST, and null on DELETE (direction
    // 'clear'). stellar-ui's hand-written type had this right.
    myVote: z.enum(['up', 'down']).nullable(),
    // Also not an integer: this is the whole ReleaseVoteAggregate row, read
    // back with findUnique after recompute — so it is null when the release
    // has no aggregate row yet.
    voteAggregate: z
      .object({
        id: z.number(),
        releaseId: z.number(),
        ups: z.number(),
        total: z.number(),
        score: z.number(),
        updatedAt: z.string()
      })
      .nullable()
  })
);

registry.registerPath({
  method: 'post',
  path: '/communities',
  tags: ['Communities'],
  summary: 'Create a community',
  description:
    'Requires `communities_manage`. `leaderId` is mandatory unless ' +
    '`registrationStatus` is `open`.',
  request: {
    body: {
      content: { 'application/json': { schema: createCommunitySchema } }
    }
  },
  responses: {
    201: {
      description: 'Community created',
      content: { 'application/json': { schema: Community } }
    },
    404: msgResponse('Leader user not found'),
    409: msgResponse('A community with that name already exists')
  }
});

registry.registerPath({
  method: 'put',
  path: '/communities/{id}',
  tags: ['Communities'],
  summary: 'Update a community',
  description:
    'Gated on `communities_manage` ALONE — a community leader or curator ' +
    'cannot configure their own community, so everything here including ' +
    '`announceVisibility` is site-staff-only. That is the settled position, ' +
    'not an oversight: ADR-0030 section 5 was amended to match the code ' +
    '(PR #469).',
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { 'application/json': { schema: updateCommunitySchema } }
    }
  },
  responses: {
    200: {
      description: 'Updated community',
      content: { 'application/json': { schema: Community } }
    },
    404: msgResponse('Community, or the named leader user, not found'),
    409: msgResponse('A community with that name already exists')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/communities/{id}',
  tags: ['Communities'],
  summary: 'Delete a community',
  description: 'Requires `communities_manage`.',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: {
      description: 'Community deleted'
    },
    404: msgResponse('Community not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/communities/{id}/members',
  tags: ['Communities'],
  summary: 'Add a member (consumer) to a community',
  description: 'Community admin or curator only.',
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: addMemberSchema
        }
      }
    }
  },
  responses: {
    201: {
      description: 'Member added',
      content: { 'application/json': { schema: CommunityMember } }
    },
    403: msgResponse('Not a community admin or curator'),
    404: msgResponse('User not found')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/communities/{id}/members/{userId}',
  tags: ['Communities'],
  summary: 'Remove a member from a community',
  description:
    'Answers 409 when the target is the community LEADER or a CURATOR: that ' +
    'role has to be removed first. The leader is checked before the curator ' +
    'because a leader is always also a curator, so the message names the ' +
    'role that actually has to be reassigned.',
  request: {
    params: z.object({ id: z.string(), userId: z.string() })
  },
  responses: {
    204: {
      description: 'Member removed'
    },
    403: msgResponse('Not a community admin or curator'),
    404: msgResponse('User not found'),
    409: msgResponse(
      'The target is the community leader or a curator; remove that role first'
    )
  }
});

registry.registerPath({
  method: 'post',
  path: '/communities/{id}/curators',
  tags: ['Communities'],
  summary: 'Promote a user to community curator',
  description:
    'Answers **204, not 201**, unlike POST /communities/{id}/members which ' +
    'answers 201. The asymmetry is existing behaviour and is documented ' +
    'rather than changed.',
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: addMemberSchema
        }
      }
    }
  },
  responses: {
    204: {
      description: 'Curator added'
    },
    403: msgResponse('Not a community admin or curator'),
    404: msgResponse('User not found')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/communities/{id}/curators/{userId}',
  tags: ['Communities'],
  summary: 'Demote a community curator',
  request: {
    params: z.object({ id: z.string(), userId: z.string() })
  },
  responses: {
    204: {
      description: 'Curator removed'
    },
    403: msgResponse('Not a community admin or curator'),
    404: msgResponse('Community or user not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/communities/{communityId}/releases',
  tags: ['Communities'],
  summary: 'Create a release in a community',
  description:
    'Requires `communities_manage`. At least one artist credit is required.',
  request: {
    params: z.object({ communityId: z.string() }),
    body: { content: { 'application/json': { schema: createGroupSchema } } }
  },
  responses: {
    201: {
      description: 'Release created',
      content: { 'application/json': { schema: Release } }
    },
    404: msgResponse('Community not found')
  }
});

registry.registerPath({
  method: 'put',
  path: '/communities/{communityId}/releases/{releaseId}',
  tags: ['Communities'],
  summary: 'Update release metadata',
  description:
    'Returns the release workbench view, not the bare release. **`tagIds` is ' +
    'accepted by the schema and then ignored** — tags are managed through the ' +
    '/tags routes, so sending them here succeeds and changes nothing. ' +
    '`editSummary` is recorded on the resulting history entry.',
  request: {
    params: z.object({
      communityId: z.string(),
      releaseId: z.string()
    }),
    body: { content: { 'application/json': { schema: updateGroupSchema } } }
  },
  responses: {
    200: {
      description: 'Updated release, as the workbench view',
      content: { 'application/json': { schema: Release } }
    },
    403: msgResponse('Not permitted to edit this release'),
    404: msgResponse('Release not found')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/communities/{communityId}/releases/{releaseId}',
  tags: ['Communities'],
  summary: 'Delete a release',
  description: 'Requires `communities_manage`.',
  request: {
    params: z.object({
      communityId: z.string(),
      releaseId: z.string()
    })
  },
  responses: {
    204: {
      description: 'Release deleted'
    },
    404: msgResponse('Release not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/communities/{communityId}/releases/{releaseId}/vote',
  tags: ['Communities'],
  summary: 'Cast or change your vote on a release',
  description: '`positive: true` is an up-vote, `false` a down-vote.',
  request: {
    params: z.object({
      communityId: z.string(),
      releaseId: z.string()
    }),
    body: { content: { 'application/json': { schema: releaseVoteSchema } } }
  },
  responses: {
    200: {
      description: 'Your vote and the new aggregate',
      content: { 'application/json': { schema: CommunityVoteState } }
    },
    403: msgResponse('Not permitted to vote in this community'),
    404: msgResponse('Release not found')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/communities/{communityId}/releases/{releaseId}/vote',
  tags: ['Communities'],
  summary: 'Clear your vote on a release',
  description:
    'Answers **200 with the new state**, not 204 — it clears a vote rather ' +
    'than deleting a resource, and the caller needs the updated aggregate.',
  request: {
    params: z.object({
      communityId: z.string(),
      releaseId: z.string()
    })
  },
  responses: {
    200: {
      description: 'Your (now cleared) vote and the new aggregate',
      content: { 'application/json': { schema: CommunityVoteState } }
    },
    403: msgResponse('Not permitted to vote in this community'),
    404: msgResponse('Release not found')
  }
});

registry.registerPath({
  method: 'get',
  path: '/communities/{communityId}/releases/{releaseId}',
  tags: ['Communities'],
  request: {
    params: z.object({
      communityId: z.string(),
      releaseId: z.string()
    })
  },
  responses: {
    200: {
      description: 'Release',
      content: { 'application/json': { schema: Release } }
    },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'get',
  path: '/communities/{communityId}/releases/{releaseId}/history',
  tags: ['Communities'],
  request: {
    params: z.object({ communityId: z.string(), releaseId: z.string() })
  },
  responses: {
    200: {
      description: 'Paginated release history',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(ReleaseHistoryEntry),
            meta: PaginationMeta
          })
        }
      }
    },
    403: msgResponse('Not a community member'),
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/communities/{communityId}/releases/{releaseId}/history/{historyId}/revert',
  tags: ['Communities'],
  request: {
    params: z.object({
      communityId: z.string(),
      releaseId: z.string(),
      historyId: z.string()
    })
  },
  responses: {
    200: {
      description: 'Release after revert',
      content: { 'application/json': { schema: Release } }
    },
    404: msgResponse('Not found'),
    422: msgResponse('Not an edit revision')
  }
});

registry.registerPath({
  method: 'post',
  path: '/communities/{communityId}/releases/{releaseId}/tags',
  tags: ['Communities'],
  request: {
    params: z.object({ communityId: z.string(), releaseId: z.string() }),
    body: {
      content: {
        'application/json': { schema: releaseTagSchema }
      }
    }
  },
  responses: {
    201: {
      description: 'Tag added',
      content: { 'application/json': { schema: ReleaseTag } }
    },
    409: msgResponse('Release already has this tag')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/communities/{communityId}/releases/{releaseId}/tags/{tagId}',
  tags: ['Communities'],
  request: {
    params: z.object({
      communityId: z.string(),
      releaseId: z.string(),
      tagId: z.string()
    })
  },
  responses: {
    204: { description: 'Tag removed' },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/communities/{communityId}/releases/{releaseId}/tags/{tagId}/vote',
  tags: ['Communities'],
  request: {
    params: z.object({
      communityId: z.string(),
      releaseId: z.string(),
      tagId: z.string()
    }),
    body: {
      content: {
        'application/json': {
          schema: releaseTagVoteSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: 'Updated tag with vote counts',
      content: { 'application/json': { schema: ReleaseTagEnriched } }
    },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'get',
  path: '/communities/{communityId}/releases/{releaseId}/contributions',
  tags: ['Communities'],
  request: {
    params: z.object({
      communityId: z.string(),
      releaseId: z.string()
    })
  },
  responses: {
    200: {
      description:
        'Release contributions with rip-quality and edition identity',
      content: {
        'application/json': {
          schema: z.array(ReleaseContributionDetail)
        }
      }
    },
    403: msgResponse('Not a member of this community'),
    404: msgResponse('Release not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/communities/{communityId}/releases/{releaseId}/contributions',
  tags: ['Communities'],
  request: {
    params: z.object({
      communityId: z.string(),
      releaseId: z.string()
    }),
    body: {
      content: {
        'application/json': {
          schema: addContributionToReleaseSchema
        }
      }
    }
  },
  responses: {
    201: {
      description: 'Contribution created',
      content: { 'application/json': { schema: Contribution } }
    },
    404: msgResponse('Release not found')
  }
});

registry.registerPath({
  method: 'get',
  path: '/contributions',
  tags: ['Contributions'],
  responses: {
    200: {
      description: 'Paginated contributions',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(Contribution),
            meta: PaginationMeta
          })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/contributions',
  tags: ['Contributions'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: createContributionSchema
        }
      }
    }
  },
  responses: {
    201: {
      description: 'Contribution submitted and release created',
      content: {
        'application/json': {
          schema: Contribution
        }
      }
    },
    404: msgResponse('Community not found')
  }
});

registry.registerPath({
  method: 'get',
  path: '/contributions/{id}',
  tags: ['Contributions'],
  summary: 'One contribution, with its release, collaborators and comments',
  description:
    'Comments carry `bodyHtml`, rendered at read time from BBCode. ' +
    '`sizeInBytes` is serialised as a number rather than the global ' +
    'BigInt-to-string default.',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Contribution',
      content: { 'application/json': { schema: Contribution } }
    },
    403: msgResponse('Not a member of the release\u2019s community'),
    404: msgResponse('Contribution not found, or its community does not exist')
  }
});

registry.registerPath({
  method: 'post',
  path: '/contributions/{id}/report',
  tags: ['Contributions'],
  summary: 'Flag a dead or misleading link on a contribution',
  description:
    'Files a `dead_link` report AND records the report against the ' +
    'contribution, which is what drives the auto-warn at three reports ' +
    '(modules/linkHealth).',
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: contributionReportSchema
        }
      }
    }
  },
  responses: {
    201: msgResponse('Report submitted'),
    404: msgResponse('Contribution not found')
  }
});

registry.registerPath({
  method: 'put',
  path: '/contributions/{id}/ratio-exempt',
  tags: ['Contributions'],
  summary: 'Staff: set or clear a contribution ratio exemption',
  description:
    'Requires the `contributions_manage` permission. FREEPASS and ' +
    'NEUTRALPASS are the Freepass/Neutralpass exemptions; NONE clears them.',
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: ratioExemptSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: 'Updated contribution',
      content: { 'application/json': { schema: Contribution } }
    },
    404: msgResponse('Contribution not found')
  }
});

registry.registerPath({
  method: 'get',
  path: '/tools/user-ranks',
  tags: ['Tools'],
  responses: {
    200: {
      description: 'User ranks',
      content: { 'application/json': { schema: z.array(UserRank) } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/tools/user-ranks/permissions',
  tags: ['Tools'],
  responses: {
    200: {
      description: 'Permission catalog',
      content: {
        'application/json': {
          schema: z.array(
            z.object({
              key: z.string(),
              title: z.string(),
              permissions: z.array(
                z.object({
                  key: PermissionKey,
                  label: z.string(),
                  description: z.string()
                })
              )
            })
          )
        }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/tools/user-ranks/{id}',
  tags: ['Tools'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'User rank',
      content: { 'application/json': { schema: UserRank } }
    },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/tools/user-ranks',
  tags: ['Tools'],
  request: {
    body: {
      content: { 'application/json': { schema: createRankSchema } }
    }
  },
  responses: {
    201: {
      description: 'User rank created',
      content: { 'application/json': { schema: UserRank } }
    },
    409: msgResponse('Duplicate rank name or level'),
    422: msgResponse('Staff group not found')
  }
});

registry.registerPath({
  method: 'put',
  path: '/tools/user-ranks/{id}',
  tags: ['Tools'],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { 'application/json': { schema: updateRankSchema } }
    }
  },
  responses: {
    200: {
      description: 'User rank updated',
      content: { 'application/json': { schema: UserRank } }
    },
    404: msgResponse('Not found'),
    409: msgResponse('Duplicate rank name or level'),
    422: msgResponse('Staff group not found')
  }
});

// ─── Comments ─────────────────────────────────────────────────────────────────

// routes/api/comments.ts projects THREE shapes off this model, and every one of
// them returns the row by spread — so all fourteen scalar columns are on the
// wire, not the six that used to be declared. What differs between the three is
// which RELATIONS are included:
//
//   GET /comments        include author + editedUser  -> CommentWithEditor
//   GET /comments/{id}   include author               -> Comment
//   POST /comments  201  include author               -> Comment
//   PUT  /comments/{id}  no include at all            -> CommentUpdated
//
// Spelled out from a shared scalar base rather than chained `.extend()`, because
// CommentUpdated REMOVES a field the others carry and an extend cannot narrow —
// see the api#488 note on `Base & Record<string, never>`.
const commentScalars = {
  id: z.number(),
  page: z.enum([
    'artist',
    'collages',
    'contributions',
    'requests',
    'communities',
    'release'
  ]),
  authorId: z.number(),
  // Raw BBCode; `bodyHtml` is the render-time transcription (#402). Every one of
  // the four responses adds it, so it is required rather than optional.
  body: z.string(),
  bodyHtml: z.string(),
  editedUserId: z.number().nullable(),
  editedAt: z.string().nullable(),
  artistId: z.number().nullable(),
  communityId: z.number().nullable(),
  contributionId: z.number().nullable(),
  requestId: z.number().nullable(),
  releaseId: z.number().nullable(),
  collageId: z.number().nullable(),
  createdAt: z.string(),
  // The list filters `deletedAt: null`, but GET /comments/{id} does NOT — it can
  // serve a soft-deleted comment, so this is not always null.
  deletedAt: z.string().nullable()
};

// `author` is guaranteed, not optional: `authorId` is a non-nullable FK and the
// include is unconditional, so the three routes that include it always send it.
const Comment = registry.register(
  'Comment',
  z.object({ ...commentScalars, author: AuthorRef })
);

const CommentWithEditor = registry.register(
  'CommentWithEditor',
  z.object({
    ...commentScalars,
    author: AuthorRef,
    // Only the list includes the editor; null when the comment was never edited.
    editedUser: z.object({ id: z.number(), username: z.string() }).nullable()
  })
);

// PUT echoes a bare `tx.comment.update()` — no include — so it carries neither
// relation. Clients cannot read `author` off an update response.
const CommentUpdated = registry.register(
  'CommentUpdated',
  z.object({ ...commentScalars })
);

const PaginatedComments = registry.register(
  'PaginatedComments',
  z.object({
    data: z.array(CommentWithEditor),
    meta: PaginationMeta
  })
);

registry.registerPath({
  method: 'delete',
  path: '/tools/user-ranks/{id}',
  tags: ['Tools'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: {
      description: 'User rank deleted'
    },
    404: msgResponse('Not found'),
    409: msgResponse('Rank still assigned to users')
  }
});

// ─── Rank Promotion Rules (#170) ─────────────────────────────────────────────────
// minContributed is bytes and crosses the wire as a string (past MAX_SAFE_INTEGER).

const RankExtraPredicateEnum = z
  .enum(['DISTINCT_RELEASES_500', 'QUALITY_CONTRIB_500'])
  .nullable();

const PromotionRule = registry.register(
  'PromotionRule',
  z.object({
    id: z.number(),
    fromRankId: z.number(),
    fromRankName: z.string().nullable(),
    toRankId: z.number(),
    toRankName: z.string().nullable(),
    minContributed: z.string(),
    minRatio: z.number(),
    minContributions: z.number(),
    minAccountAgeDays: z.number(),
    extra: RankExtraPredicateEnum,
    enabled: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string()
  })
);

const PromotionRuleCreateBody = z.object({
  fromRankId: z.number().int().positive(),
  toRankId: z.number().int().positive(),
  minContributed: z.string().optional(),
  minRatio: z.number().min(0).optional(),
  minContributions: z.number().int().min(0).optional(),
  minAccountAgeDays: z.number().int().min(0).optional(),
  extra: RankExtraPredicateEnum.optional(),
  enabled: z.boolean().optional()
});

const PromotionRuleUpdateBody = PromotionRuleCreateBody.partial();

registry.registerPath({
  method: 'get',
  path: '/tools/promotion-rules',
  tags: ['Tools'],
  responses: {
    200: {
      description: 'Promotion rules',
      content: { 'application/json': { schema: z.array(PromotionRule) } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/tools/promotion-rules/{id}',
  tags: ['Tools'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Promotion rule',
      content: { 'application/json': { schema: PromotionRule } }
    },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/tools/promotion-rules',
  tags: ['Tools'],
  request: {
    body: {
      content: { 'application/json': { schema: PromotionRuleCreateBody } }
    }
  },
  responses: {
    201: {
      description: 'Promotion rule created',
      content: { 'application/json': { schema: PromotionRule } }
    },
    409: msgResponse('Duplicate rank pair'),
    422: msgResponse('fromRank or toRank not found')
  }
});

registry.registerPath({
  method: 'put',
  path: '/tools/promotion-rules/{id}',
  tags: ['Tools'],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { 'application/json': { schema: PromotionRuleUpdateBody } }
    }
  },
  responses: {
    200: {
      description: 'Promotion rule updated',
      content: { 'application/json': { schema: PromotionRule } }
    },
    404: msgResponse('Not found'),
    409: msgResponse('Duplicate rank pair'),
    422: msgResponse('fromRank or toRank not found')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/tools/promotion-rules/{id}',
  tags: ['Tools'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Promotion rule deleted' },
    404: msgResponse('Not found')
  }
});

// ─── Staff Groups ──────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/tools/staff-groups',
  tags: ['Tools'],
  responses: {
    200: {
      description: 'Staff groups',
      content: { 'application/json': { schema: z.array(StaffGroup) } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/tools/staff-groups',
  tags: ['Tools'],
  request: {
    body: {
      content: { 'application/json': { schema: createStaffGroupSchema } }
    }
  },
  responses: {
    201: {
      description: 'Staff group created',
      content: { 'application/json': { schema: StaffGroup } }
    },
    409: msgResponse('Duplicate name')
  }
});

registry.registerPath({
  method: 'put',
  path: '/tools/staff-groups/{id}',
  tags: ['Tools'],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { 'application/json': { schema: updateStaffGroupSchema } }
    }
  },
  responses: {
    200: {
      description: 'Staff group updated',
      content: { 'application/json': { schema: StaffGroup } }
    },
    404: msgResponse('Not found'),
    409: msgResponse('Duplicate name')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/tools/staff-groups/{id}',
  tags: ['Tools'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Staff group deleted' },
    404: msgResponse('Not found'),
    409: msgResponse('Ranks still assigned')
  }
});

// ─── Staff page ────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/staff',
  tags: ['Staff'],
  responses: {
    200: {
      description: 'Staff listing grouped by staff group',
      content: {
        'application/json': {
          schema: z.object({ groups: z.array(StaffGroupWithMembers) })
        }
      }
    }
  }
});

// ─── Staff bio ────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'put',
  path: '/users/{id}/staff-bio',
  tags: ['Users'],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: staffBioSchema
        }
      }
    }
  },
  responses: {
    200: msgResponse('Staff bio updated'),
    403: msgResponse('Not the subject and missing admin'),
    404: msgResponse('User not found')
  }
});

registry.registerPath({
  method: 'get',
  path: '/comments',
  tags: ['Comments'],
  request: {
    query: commentQuerySchema
  },
  responses: {
    200: {
      description: 'Comments',
      content: { 'application/json': { schema: PaginatedComments } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/comments',
  tags: ['Comments'],
  request: {
    body: {
      content: {
        'application/json': { schema: createCommentSchema }
      }
    }
  },
  responses: {
    201: {
      description: 'Comment created',
      content: { 'application/json': { schema: Comment } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/comments/{id}',
  tags: ['Comments'],
  summary: 'One comment, with its author',
  description:
    'Requires a session, and never serves a soft-deleted comment — it ' +
    'filters `deletedAt` exactly as GET /comments does. Both were absent ' +
    'until #509 F4: the route was the only comment route with no auth ' +
    'middleware, and soft-deleted bodies (which `deleteComment` retains ' +
    'verbatim) were readable with no session by guessing an integer id.',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Comment',
      content: { 'application/json': { schema: Comment } }
    },
    404: msgResponse('Comment not found, or soft-deleted')
  }
});

registry.registerPath({
  method: 'put',
  path: '/comments/{id}',
  tags: ['Comments'],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { 'application/json': { schema: updateCommentSchema } }
    }
  },
  responses: {
    200: {
      // NOT `Comment`: the handler echoes a bare `tx.comment.update()` with no
      // include, so this response carries neither `author` nor `editedUser`.
      description: 'Comment updated — scalars only, no author/editor relation',
      content: { 'application/json': { schema: CommentUpdated } }
    },
    403: msgResponse('Not the comment author'),
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/comments/{id}',
  tags: ['Comments'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: {
      description: 'Comment deleted'
    },
    403: msgResponse('Not the comment author and missing reports_manage'),
    404: msgResponse('Not found')
  }
});

// ─── Artists ──────────────────────────────────────────────────────────────────

const Artist = registry.register(
  'Artist',
  z.object({
    id: z.number(),
    name: z.string(),
    vanityHouse: z.boolean(),
    _count: z
      .object({
        releases: z.number()
      })
      .optional(),
    aliases: z
      .array(
        z.object({
          redirect: z.object({
            id: z.number(),
            name: z.string()
          })
        })
      )
      .optional(),
    tags: z
      .array(
        z.object({
          tag: z.object({
            id: z.number(),
            name: z.string()
          })
        })
      )
      .optional(),
    similarTo: z
      .array(
        z.object({
          similarArtist: z.object({
            id: z.number(),
            name: z.string()
          })
        })
      )
      .optional(),
    description: z.string().nullable().optional(),
    releases: z
      .array(
        z.object({
          id: z.number(),
          title: z.string(),
          year: z.number().nullable().optional(),
          type: ReleaseTypeEnum,
          releaseType: ReleaseCategoryEnum,
          communityId: z.number().nullable().optional(),
          community: z
            .object({
              id: z.number(),
              name: z.string()
            })
            .nullable()
            .optional()
        })
      )
      .optional(),
    isSubscribed: z.boolean().optional()
  })
);

const ArtistHistory = registry.register(
  'ArtistHistory',
  z.object({
    id: z.number(),
    artistId: z.number(),
    editedAt: z.string(),
    description: z.string().nullable().optional(),
    editedUser: z
      .object({
        id: z.number(),
        username: z.string()
      })
      .optional()
  })
);

// Two shapes, one model. `POST /artists/similar` echoes the bare join row from
// an `upsert` with no `select`; `GET /artists/{id}/similar` returns the same row
// with the referenced artist included. The component used to declare ONLY the
// nested artist — so it described neither route: it omitted every scalar the
// list carries, and named a relation the create echo does not have.
const SimilarArtist = registry.register(
  'SimilarArtist',
  z.object({
    id: z.number(),
    artistId: z.number(),
    similarArtistId: z.number(),
    score: z.number(),
    // Json column defaulted to []; the vote ledger, shape not pinned here.
    votes: z.unknown()
  })
);

// Extends by ADDING a property, which is the direction that generates correctly
// (see the api#488 note on narrowing extends).
const SimilarArtistEntry = registry.register(
  'SimilarArtistEntry',
  SimilarArtist.extend({
    similarArtist: z.object({ id: z.number(), name: z.string() })
  })
);

registry.registerPath({
  method: 'get',
  path: '/artists',
  tags: ['Artists'],
  responses: {
    200: {
      description: 'Paginated artists',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(Artist),
            meta: PaginationMeta
          })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/artists',
  tags: ['Artists'],
  request: {
    body: { content: { 'application/json': { schema: artistSchema } } }
  },
  responses: {
    201: {
      description: 'Artist created',
      content: { 'application/json': { schema: Artist } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/artists/{id}',
  tags: ['Artists'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Artist with releases and tags',
      content: { 'application/json': { schema: Artist } }
    },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'put',
  path: '/artists/{id}',
  tags: ['Artists'],
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: artistSchema } } }
  },
  responses: {
    200: {
      description: 'Artist updated',
      content: { 'application/json': { schema: Artist } }
    },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/artists/{id}',
  tags: ['Artists'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: {
      description: 'Artist deleted'
    },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'get',
  path: '/artists/{id}/subscribe',
  tags: ['Artists'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Subscription status',
      content: {
        'application/json': {
          schema: z.object({ subscribed: z.boolean() })
        }
      }
    },
    404: msgResponse('Artist not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/artists/{id}/subscribe',
  tags: ['Artists'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Subscribed',
      content: {
        'application/json': {
          schema: z.object({ subscribed: z.boolean() })
        }
      }
    },
    404: msgResponse('Artist not found')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/artists/{id}/subscribe',
  tags: ['Artists'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Unsubscribed',
      content: {
        'application/json': {
          schema: z.object({ subscribed: z.boolean() })
        }
      }
    },
    404: msgResponse('Artist not found')
  }
});

registry.registerPath({
  method: 'get',
  path: '/artists/history/{artistId}',
  tags: ['Artists'],
  request: { params: z.object({ artistId: z.string() }) },
  responses: {
    200: {
      description: 'Artist history',
      content: { 'application/json': { schema: z.array(ArtistHistory) } }
    },
    404: msgResponse('Artist not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/artists/revert/{historyId}',
  tags: ['Artists'],
  request: { params: z.object({ historyId: z.string() }) },
  responses: {
    200: {
      description: 'Artist reverted',
      content: {
        'application/json': {
          schema: z.object({
            msg: z.string(),
            artist: Artist
          })
        }
      }
    },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'get',
  path: '/artists/{id}/similar',
  tags: ['Artists'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Similar artists',
      content: { 'application/json': { schema: z.array(SimilarArtistEntry) } }
    },
    404: msgResponse('Artist not found')
  }
});

// These three routes return the raw join row from an `upsert`/`create` with no
// `select`, so the shape is exactly the Prisma model. They were registered as
// `z.record(z.unknown())` — an admission that the shape was unknown, which gave
// every consumer `{ [key: string]: unknown }` and no reason to prefer the
// contract over a hand-written guess.
const ArtistAlias = registry.register(
  'ArtistAlias',
  z.object({
    id: z.number(),
    artistId: z.number(),
    redirectId: z.number(),
    userId: z.number().nullable()
  })
);

const ArtistTag = registry.register(
  'ArtistTag',
  z.object({
    id: z.number(),
    artistId: z.number(),
    tagId: z.number(),
    positiveVotes: z.number(),
    negativeVotes: z.number(),
    userId: z.number().nullable()
  })
);

registry.registerPath({
  method: 'post',
  path: '/artists/similar',
  tags: ['Artists'],
  request: {
    body: {
      content: { 'application/json': { schema: similarArtistSchema } }
    }
  },
  responses: {
    200: {
      description: 'Similar artist link created',
      content: {
        'application/json': { schema: SimilarArtist }
      }
    },
    409: msgResponse('That similarity is already recorded')
  }
});

registry.registerPath({
  method: 'post',
  path: '/artists/alias',
  tags: ['Artists'],
  request: {
    body: { content: { 'application/json': { schema: artistAliasSchema } } }
  },
  responses: {
    201: {
      description: 'Artist alias created',
      content: {
        'application/json': { schema: ArtistAlias }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/artists/tag',
  tags: ['Artists'],
  request: {
    body: { content: { 'application/json': { schema: artistTagSchema } } }
  },
  responses: {
    200: {
      description: 'Artist tagged',
      content: {
        'application/json': { schema: ArtistTag }
      }
    },
    409: msgResponse('Tag vote already being recorded, retry')
  }
});

// ─── Posts ────────────────────────────────────────────────────────────────────

const PostComment = registry.register(
  'PostComment',
  z.object({
    id: z.number(),
    postId: z.number(),
    userId: z.number(),
    text: z.string(),
    createdAt: z.string(),
    user: AuthorRef.optional()
  })
);

const Post = registry.register(
  'Post',
  z.object({
    id: z.number(),
    userId: z.number(),
    title: z.string(),
    text: z.string(),
    category: z.string(),
    tags: z.array(z.string()),
    comments: z.array(PostComment),
    createdAt: z.string(),
    user: AuthorRef.optional()
  })
);

registry.registerPath({
  method: 'get',
  path: '/posts',
  tags: ['Posts'],
  responses: {
    200: {
      description: 'All posts',
      content: { 'application/json': { schema: z.array(Post) } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/posts/{id}',
  tags: ['Posts'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Post',
      content: { 'application/json': { schema: Post } }
    },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/posts',
  tags: ['Posts'],
  request: {
    body: { content: { 'application/json': { schema: postSchema } } }
  },
  responses: {
    201: {
      description: 'Post created',
      content: { 'application/json': { schema: Post } }
    }
  }
});

registry.registerPath({
  method: 'delete',
  path: '/posts/{id}',
  tags: ['Posts'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Post deleted' },
    403: msgResponse('Not the post author'),
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/posts/{id}/comments',
  tags: ['Posts'],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { 'application/json': { schema: postCommentSchema } }
    }
  },
  responses: {
    201: {
      description: 'Comment created',
      content: { 'application/json': { schema: PostComment } }
    },
    404: msgResponse('Post not found')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/posts/{id}/comments/{commentId}',
  tags: ['Posts'],
  request: {
    params: z.object({ id: z.string(), commentId: z.string() })
  },
  responses: {
    204: { description: 'Comment deleted' },
    403: msgResponse('Not the comment author'),
    404: msgResponse('Comment not found')
  }
});

// ─── Forum topic notes ────────────────────────────────────────────────────────

const ForumTopicNote = registry.register(
  'ForumTopicNote',
  z.object({
    id: z.number(),
    forumTopicId: z.number(),
    authorId: z.number(),
    body: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    author: z.object({ id: z.number(), username: z.string() }).optional()
  })
);

registry.registerPath({
  method: 'get',
  path: '/forums/topic-notes/{topicId}',
  tags: ['Forums'],
  request: { params: z.object({ topicId: z.string() }) },
  responses: {
    200: {
      description: 'Topic notes (moderators only)',
      content: { 'application/json': { schema: z.array(ForumTopicNote) } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/forums/topic-notes',
  tags: ['Forums'],
  request: {
    body: { content: { 'application/json': { schema: topicNoteSchema } } }
  },
  responses: {
    201: {
      description: 'Note created',
      content: { 'application/json': { schema: ForumTopicNote } }
    }
  }
});

registry.registerPath({
  method: 'delete',
  path: '/forums/topic-notes/{id}',
  tags: ['Forums'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Note deleted' },
    403: msgResponse('Not authorized'),
    404: msgResponse('Not found')
  }
});

// ─── Requests ────────────────────────────────────────────────────────────────

// `user` is OPTIONAL because the bounty relation is included two different
// ways. Only three reads pull the pledger in — the detail route, add-bounty and
// bounty-history (`bounties: { include: { user } }`); the list, create, update,
// fill and unfill echoes use a bare `bounties: true` and carry no `user` at
// all. `userId` is always there, so a client that needs a name on those five
// resolves it itself.
const RequestBountyEntry = registry.register(
  'RequestBountyEntry',
  z.object({
    id: z.number().int(),
    requestId: z.number().int(),
    userId: z.number().int(),
    // BigInt column — serialises as a string, not a number.
    amount: z.string(),
    createdAt: z.string(),
    user: z.object({ id: z.number().int(), username: z.string() }).optional()
  })
);

// Where the pledger IS guaranteed: bounty-history and the detail route both
// include it. Named separately rather than left to the optional shared shape,
// so a client rendering a pledger list is not made to null-check a field those
// two responses always carry.
//
// Spelled out rather than `RequestBountyEntry.extend({ user: ... })`: an extend
// that only tightens a field the base already declares emits an allOf branch
// with an EMPTY property set, and openapi-typescript renders that as
// `Base & Record<string, never>` — the requirement is lost and the intersection
// is hostile. Extending works when it ADDS properties (see RequestDetail); it
// does not work for narrowing one.
const RequestBountyEntryWithUser = registry.register(
  'RequestBountyEntryWithUser',
  z.object({
    id: z.number().int(),
    requestId: z.number().int(),
    userId: z.number().int(),
    amount: z.string(),
    createdAt: z.string(),
    user: z.object({ id: z.number().int(), username: z.string() })
  })
);

// The join row, and it too is included two ways: `POST /requests` echoes bare
// `artists: true` rows, while the detail route pulls the artist itself
// (`artists: { include: { artist: true } }`). A bare Artist row is exactly the
// three required fields of the Artist component — the rest of that component is
// relation includes this join never asks for.
const RequestArtistRef = registry.register(
  'RequestArtistRef',
  z.object({
    id: z.number().int(),
    requestId: z.number().int(),
    artistId: z.number().int(),
    artist: Artist.optional()
  })
);

// Every request-returning route answers with `serializeRequest(...)`, NOT the
// bare Prisma row: the BigInt bounties are summed into `totalBounty` (a string),
// `_count.bounties` is attached, and the relations are optional depending on
// what the caller's query included. `voteCount` is deliberately absent here —
// only the detail route adds it (see RequestDetail).
const Request = registry.register(
  'Request',
  z.object({
    id: z.number().int(),
    communityId: z.number().int(),
    userId: z.number().int(),
    title: z.string(),
    description: z.string(),
    type: ReleaseTypeEnum,
    year: z.number().int().nullable(),
    image: z.string().nullable(),
    status: z.nativeEnum(RequestStatus),
    fillerId: z.number().int().nullable(),
    filledAt: z.string().nullable(),
    filledContributionId: z.number().int().nullable(),
    // Sum of every bounty on the request. BigInt column, so a string.
    totalBounty: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    deletedAt: z.string().nullable(),
    _count: z.object({ bounties: z.number().int() }),
    user: z.object({ id: z.number().int(), username: z.string() }).optional(),
    filler: z
      .object({ id: z.number().int(), username: z.string() })
      .nullable()
      .optional(),
    community: z.object({ id: z.number().int(), name: z.string() }).optional(),
    bounties: z.array(RequestBountyEntry).optional(),
    artists: z.array(RequestArtistRef).optional(),
    // Only the detail route includes this, and it pulls a whole Contribution
    // plus its release and uploader. Left unknown rather than half-described:
    // no client reads it yet, and guessing at the Contribution shape here is
    // how the rest of this section went wrong.
    filledContribution: z.unknown().optional()
  })
);

// The detail route alone adds the vote fields on top of the serialized shape.
const RequestDetail = registry.register(
  'RequestDetail',
  Request.extend({
    // This route's include pulls the pledger on every bounty, so the narrower
    // shape applies here rather than the shared optional one.
    bounties: z.array(RequestBountyEntryWithUser).optional(),
    voteCount: z.number().int(),
    votes: z.array(z.object({ userId: z.number().int() }))
  })
);

const RequestActionEntry = registry.register(
  'RequestActionEntry',
  z.object({
    id: z.number().int(),
    requestId: z.number().int(),
    actorId: z.number().int(),
    action: z.nativeEnum(RequestActionType),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.string()
  })
);

registry.registerPath({
  method: 'put',
  path: '/requests/{id}',
  tags: ['Requests'],
  summary: 'Edit a request',
  description:
    'The owner, or a holder of `requests_moderate`. Only requests in the ' +
    '`open` status may be edited — editing a filled or deleted one answers ' +
    '**422**, which this router uses for STATE violations as distinct from ' +
    'the 400 it uses for validation.',
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { 'application/json': { schema: updateRequestSchema } }
    }
  },
  responses: {
    200: {
      description: 'Updated request',
      content: { 'application/json': { schema: Request } }
    },
    403: msgResponse('Neither the owner nor a request moderator'),
    404: msgResponse('Request not found'),
    422: msgResponse('Only open requests can be edited')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/requests/{id}',
  tags: ['Requests'],
  summary: 'Delete a request',
  description: 'The owner, or a holder of `requests_moderate`.',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: {
      description: 'Request deleted'
    },
    403: msgResponse(
      'Neither the owner nor a request moderator, or the request is filled and the caller is not a request moderator'
    ),
    404: msgResponse('Request not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/requests/{id}/vote',
  tags: ['Requests'],
  summary: 'Toggle your vote on a request',
  description:
    'A TOGGLE despite the name: posting when you have already voted removes ' +
    'the vote. The response says which state you ended in. Takes no body.',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Resulting vote state',
      content: {
        'application/json': { schema: z.object({ voted: z.boolean() }) }
      }
    },
    404: msgResponse('Request not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/requests/{id}/unfill',
  tags: ['Requests'],
  summary: 'Reverse a fill on a request',
  description:
    'The owner, the filler, or a holder of `requests_moderate`. A request ' +
    'that is not currently filled answers **422**.',
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { 'application/json': { schema: unfillRequestSchema } }
    }
  },
  responses: {
    200: {
      description: 'The request, back in the open status',
      content: { 'application/json': { schema: Request } }
    },
    403: msgResponse('Neither owner, filler, nor a request moderator'),
    404: msgResponse('Request not found'),
    422: msgResponse('Request is not filled')
  }
});

registry.registerPath({
  method: 'get',
  path: '/requests/{id}/bounty-history',
  tags: ['Requests'],
  summary: 'Every bounty and lifecycle action on a request',
  description:
    'Two parallel lists, each newest first: the bounties pledged, and the ' +
    'lifecycle actions (create, add bounty, fill, unfill, delete, restore). ' +
    'Bounty `amount` is a BigInt column and serialises as a string.',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Bounties and actions',
      content: {
        'application/json': {
          schema: z.object({
            bounties: z.array(RequestBountyEntryWithUser),
            actions: z.array(RequestActionEntry)
          })
        }
      }
    },
    404: msgResponse('Request not found')
  }
});

registry.registerPath({
  method: 'get',
  path: '/requests',
  summary: 'List requests',
  tags: ['Requests'],
  request: { query: listRequestsQuerySchema },
  responses: {
    200: {
      description: 'Paginated requests',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(Request), meta: PaginationMeta })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/requests',
  summary: 'Create a new request',
  tags: ['Requests'],
  request: {
    body: {
      content: { 'application/json': { schema: createRequestSchema } }
    }
  },
  responses: {
    201: {
      description: 'Request created',
      content: { 'application/json': { schema: Request } }
    },
    403: msgResponse('Missing requests_create')
  }
});

registry.registerPath({
  method: 'get',
  path: '/requests/{id}',
  summary: 'Get request details',
  tags: ['Requests'],
  description:
    'The only request response that carries `voteCount` and `votes`; the ' +
    'other routes return the serialized request without them.',
  request: {
    params: z.object({ id: z.string() })
  },
  responses: {
    200: {
      description: 'Request detail',
      content: { 'application/json': { schema: RequestDetail } }
    },
    404: msgResponse('Request not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/requests/{id}/bounty',
  summary: 'Add bounty to request',
  tags: ['Requests'],
  description:
    "The amount is deducted from the caller's contributed balance, so an " +
    'insufficient balance answers 400 rather than 403. There is a site ' +
    'minimum bounty; below it is also a 400.',
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { 'application/json': { schema: addBountySchema } }
    }
  },
  responses: {
    200: {
      description: 'The request, with the new bounty totalled in',
      content: { 'application/json': { schema: Request } }
    },
    400: msgResponse(
      'Below the minimum bounty, or insufficient contributed balance'
    ),
    404: msgResponse('Request not found, or not open')
  }
});

registry.registerPath({
  method: 'post',
  path: '/requests/{id}/fill',
  summary: 'Fill request',
  tags: ['Requests'],
  description:
    'Nominates a contribution as the fill. The bounty is paid out and the ' +
    'request moves to the `filled` status; POST /requests/{id}/unfill reverses ' +
    'it.',
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { 'application/json': { schema: fillRequestSchema } }
    }
  },
  responses: {
    200: {
      description: 'The request, now filled',
      content: { 'application/json': { schema: Request } }
    },
    400: msgResponse(
      'The contribution is not eligible: wrong community, wrong release type, or already the active fill for another request'
    ),
    403: msgResponse('You can only fill a request with your own contribution'),
    404: msgResponse(
      'Request or contribution not found, or the request is not open'
    ),
    409: msgResponse(
      'Lost a race — the request was already filled by another submission'
    )
  }
});

// ─── Private Messages ────────────────────────────────────────────────────────

// PM senders/participants carry the full AuthorRef (#231) so donor/warning
// signs render in conversations; the old thin MessageUser shape is retired.
const MessageUser = AuthorRef;

const PrivateMessage = registry.register(
  'PrivateMessage',
  z.object({
    id: z.number(),
    conversationId: z.number(),
    body: z.string(),
    createdAt: z.string(),
    sender: MessageUser.nullable().optional()
  })
);

const PrivateConversationParticipant = registry.register(
  'PrivateConversationParticipant',
  z.object({
    userId: z.number(),
    conversationId: z.number(),
    inInbox: z.boolean(),
    inSentbox: z.boolean(),
    isRead: z.boolean(),
    isSticky: z.boolean(),
    sentAt: z.string().nullable().optional(),
    receivedAt: z.string().nullable().optional(),
    user: MessageUser.optional()
  })
);

const PrivateConversation = registry.register(
  'PrivateConversation',
  z.object({
    id: z.number(),
    subject: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    participants: z.array(PrivateConversationParticipant).optional(),
    messages: z.array(PrivateMessage).optional()
  })
);

const PaginatedConversations = registry.register(
  'PaginatedConversations',
  z.object({
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    conversations: z.array(PrivateConversation)
  })
);

import {
  composeMessageSchema,
  replyMessageSchema,
  updateConversationSchema,
  bulkMessageActionSchema,
  messageListQuerySchema
} from '../schemas/pm';

registry.registerPath({
  method: 'get',
  path: '/messages',
  tags: ['Messages'],
  request: { query: messageListQuerySchema },
  responses: {
    200: {
      description: 'Inbox conversations',
      content: { 'application/json': { schema: PaginatedConversations } }
    }
  }
});

const PmDraft = registry.register(
  'PmDraft',
  z.object({
    id: z.number().int(),
    userId: z.number().int(),
    toUserId: z.number().int().nullable(),
    subject: z.string().max(255),
    body: z.string(),
    createdAt: z.string(),
    updatedAt: z.string()
  })
);

// The list route resolves each draft's recipient separately and decorates the
// row, so what comes back is a PmDraft PLUS `toUser` — not the bare model.
const PmDraftWithRecipient = registry.register(
  'PmDraftWithRecipient',
  PmDraft.extend({
    toUser: z.object({ id: z.number().int(), username: z.string() }).nullable()
  })
);

registry.registerPath({
  method: 'get',
  path: '/messages/drafts',
  tags: ['Messages'],
  summary: 'Draft private messages belonging to the caller',
  description: 'Newest `updatedAt` first.',
  responses: {
    200: {
      description: 'Drafts',
      content: {
        'application/json': { schema: z.array(PmDraftWithRecipient) }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/messages/drafts',
  tags: ['Messages'],
  summary: 'Create a draft private message',
  description:
    'The recipient may be given as `toUserId` or `toUsername`; either is ' +
    'optional, so a draft can be saved before a recipient is chosen.',
  request: {
    body: { content: { 'application/json': { schema: pmDraftSchema } } }
  },
  responses: {
    201: {
      description: 'Draft created',
      content: { 'application/json': { schema: PmDraft } }
    },
    404: msgResponse('No user with that username')
  }
});

registry.registerPath({
  method: 'put',
  path: '/messages/drafts/{id}',
  tags: ['Messages'],
  summary: 'Update one of your drafts',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: pmDraftSchema } } }
  },
  responses: {
    200: {
      description: 'Draft updated',
      content: { 'application/json': { schema: PmDraft } }
    },
    404: msgResponse('No such draft belonging to the caller')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/messages/drafts/{id}',
  tags: ['Messages'],
  summary: 'Delete one of your drafts',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: {
      description: 'Draft deleted'
    },
    404: msgResponse('No such draft belonging to the caller')
  }
});

registry.registerPath({
  method: 'post',
  path: '/messages/mass',
  tags: ['Messages'],
  summary: 'Staff: send one message to every active member, or one rank',
  description:
    'Requires the `messages_mass_pm` permission. **Capped at 1000 recipients** ' +
    '(`take: 1000`), so a larger site silently reaches only the first 1000; ' +
    'the sender is skipped. Omit `targetRankId` to target every active member. ' +
    'The send is also recorded as a MassMessage row.',
  request: {
    body: { content: { 'application/json': { schema: massPmSchema } } }
  },
  responses: {
    200: {
      description: 'How many conversations were created',
      content: {
        'application/json': {
          schema: z.object({ sentCount: z.number().int() })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/messages/unread-count',
  tags: ['Messages'],
  responses: {
    200: {
      description: 'Unread conversation count',
      content: {
        'application/json': { schema: z.object({ count: z.number() }) }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/messages/sent',
  tags: ['Messages'],
  responses: {
    200: {
      description: 'Sent conversations',
      content: { 'application/json': { schema: PaginatedConversations } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/messages/bulk',
  tags: ['Messages'],
  request: {
    body: {
      content: { 'application/json': { schema: bulkMessageActionSchema } }
    }
  },
  responses: {
    204: { description: 'Bulk action applied' }
  }
});

registry.registerPath({
  method: 'post',
  path: '/messages',
  tags: ['Messages'],
  request: {
    body: { content: { 'application/json': { schema: composeMessageSchema } } }
  },
  responses: {
    201: {
      description: 'Conversation created',
      content: { 'application/json': { schema: PrivateConversation } }
    },
    400: msgResponse(
      'Cannot message yourself. A request-body validation failure also ' +
        'answers 400, carrying an `errors` object this schema does not show'
    ),
    404: msgResponse('No such recipient'),
    422: msgResponse(
      'Recipient is disabled, or has private messages turned off'
    )
  }
});

registry.registerPath({
  method: 'get',
  path: '/messages/{id}',
  tags: ['Messages'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Conversation with messages',
      content: { 'application/json': { schema: PrivateConversation } }
    },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/messages/{id}/reply',
  tags: ['Messages'],
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: replyMessageSchema } } }
  },
  responses: {
    201: {
      description: 'Reply sent',
      content: { 'application/json': { schema: PrivateMessage } }
    },
    403: msgResponse('Not a participant')
  }
});

registry.registerPath({
  method: 'patch',
  path: '/messages/{id}',
  tags: ['Messages'],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { 'application/json': { schema: updateConversationSchema } }
    }
  },
  responses: {
    204: { description: 'Flags updated' },
    404: msgResponse(
      "No such conversation, or it is not the caller's, or the caller has " +
        'already deleted it from both boxes'
    )
  }
});

registry.registerPath({
  method: 'delete',
  path: '/messages/{id}',
  tags: ['Messages'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Conversation soft-deleted' },
    404: msgResponse("No such conversation, or it is not the caller's")
  }
});

// ─── Staff Inbox ──────────────────────────────────────────────────────────────

import {
  createResponseSchema,
  updateResponseSchema,
  createTicketSchema,
  replySchema as staffReplySchema,
  assignSchema,
  queueQuerySchema,
  bulkResolveSchema
} from '../schemas/staffInbox';

const StaffInboxTicket = registry.register(
  'StaffInboxTicket',
  z.object({
    id: z.number(),
    subject: z.string(),
    status: z.enum(['Unanswered', 'Open', 'Resolved']),
    isReadByUser: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    user: MessageUser,
    assignedUser: MessageUser.nullable().optional(),
    resolver: MessageUser.nullable().optional(),
    messages: z
      .array(
        z.object({
          id: z.number(),
          body: z.string(),
          createdAt: z.string(),
          sender: MessageUser.nullable()
        })
      )
      .optional()
  })
);

const PaginatedTickets = registry.register(
  'PaginatedTickets',
  z.object({
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    conversations: z.array(StaffInboxTicket)
  })
);

registry.registerPath({
  method: 'get',
  path: '/staff-inbox/tickets',
  tags: ['StaffInbox'],
  responses: {
    200: {
      description: 'My support tickets',
      content: { 'application/json': { schema: PaginatedTickets } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/staff-inbox/tickets',
  tags: ['StaffInbox'],
  request: {
    body: { content: { 'application/json': { schema: createTicketSchema } } }
  },
  responses: {
    201: {
      description: 'Ticket created',
      content: { 'application/json': { schema: StaffInboxTicket } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/staff-inbox/tickets/count',
  tags: ['StaffInbox'],
  responses: {
    200: {
      description: 'Count of tickets with unread staff replies',
      content: {
        'application/json': { schema: z.object({ count: z.number() }) }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/staff-inbox/queue',
  tags: ['StaffInbox'],
  request: { query: queueQuerySchema },
  responses: {
    200: {
      description: 'Staff ticket queue',
      content: { 'application/json': { schema: PaginatedTickets } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/staff-inbox/queue/count',
  tags: ['StaffInbox'],
  responses: {
    200: {
      description: 'Unresolved ticket count',
      content: {
        'application/json': { schema: z.object({ count: z.number() }) }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/staff-inbox/bulk-resolve',
  tags: ['StaffInbox'],
  request: {
    body: {
      content: { 'application/json': { schema: bulkResolveSchema } }
    }
  },
  responses: {
    200: {
      description: 'Tickets bulk resolved',
      content: {
        'application/json': {
          schema: z.object({ ok: z.boolean(), resolved: z.number() })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/staff-inbox/tickets/{id}',
  tags: ['StaffInbox'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Ticket with messages',
      content: { 'application/json': { schema: StaffInboxTicket } }
    },
    404: msgResponse('Not found')
  }
});

// The message rows embedded in StaffInboxTicket, named so the reply route can
// declare what it returns.
const StaffInboxMessage = registry.register(
  'StaffInboxMessage',
  z.object({
    id: z.number(),
    body: z.string(),
    createdAt: z.string(),
    sender: AuthorRef.nullable()
  })
);

registry.registerPath({
  method: 'post',
  path: '/staff-inbox/tickets/{id}/reply',
  tags: ['StaffInbox'],
  summary: 'Reply to a staff-inbox ticket',
  description:
    'Returns the created message. A ticket belonging to someone else is ' +
    'masked as **404, never 403** — the route deliberately does not confirm ' +
    "that another member's ticket exists.",
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: staffReplySchema } } }
  },
  responses: {
    201: {
      description: 'Reply sent',
      content: { 'application/json': { schema: StaffInboxMessage } }
    },
    404: msgResponse("No such ticket, or it is not the caller's"),
    422: msgResponse('Ticket resolved')
  }
});

registry.registerPath({
  method: 'post',
  path: '/staff-inbox/tickets/{id}/resolve',
  tags: ['StaffInbox'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Resolved' },
    404: msgResponse("No such ticket, or it is not the caller's"),
    422: msgResponse('Ticket already resolved')
  }
});

registry.registerPath({
  method: 'post',
  path: '/staff-inbox/tickets/{id}/unresolve',
  tags: ['StaffInbox'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Unresolved' },
    404: msgResponse('No such ticket'),
    422: msgResponse('Ticket is not resolved')
  }
});

registry.registerPath({
  method: 'post',
  path: '/staff-inbox/tickets/{id}/assign',
  tags: ['StaffInbox'],
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: assignSchema } } }
  },
  responses: {
    204: { description: 'Assigned' },
    404: msgResponse('No such ticket, or no such assignee'),
    422: msgResponse('The named assignee lacks staff_inbox_manage')
  }
});

const StaffInboxResponse = registry.register(
  'StaffInboxResponse',
  z.object({
    id: z.number(),
    name: z.string(),
    body: z.string(),
    createdAt: z.string(),
    updatedAt: z.string()
  })
);

registry.registerPath({
  method: 'get',
  path: '/staff-inbox/responses',
  tags: ['StaffInbox'],
  responses: {
    200: {
      description: 'Canned responses',
      content: { 'application/json': { schema: z.array(StaffInboxResponse) } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/staff-inbox/responses',
  tags: ['StaffInbox'],
  request: {
    body: { content: { 'application/json': { schema: createResponseSchema } } }
  },
  responses: {
    201: {
      description: 'Response created',
      content: { 'application/json': { schema: StaffInboxResponse } }
    }
  }
});

registry.registerPath({
  method: 'put',
  path: '/staff-inbox/responses/{id}',
  tags: ['StaffInbox'],
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: updateResponseSchema } } }
  },
  responses: {
    200: {
      description: 'Response updated',
      content: { 'application/json': { schema: StaffInboxResponse } }
    },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/staff-inbox/responses/{id}',
  tags: ['StaffInbox'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Response deleted' },
    404: msgResponse('Response not found')
  }
});

// ─── Reports ──────────────────────────────────────────────────────────────────

const ReportUser = z.object({
  id: z.number(),
  username: z.string(),
  avatar: z.string().nullable()
});

const ReportNoteObj = z.object({
  id: z.number(),
  reportId: z.number(),
  authorId: z.number(),
  author: ReportUser,
  body: z.string(),
  createdAt: z.string()
});

const ReportObj = z.object({
  id: z.number(),
  reporterId: z.number(),
  reporter: ReportUser,
  targetType: z.enum([
    'User',
    'Release',
    'Artist',
    'Contribution',
    'ForumTopic',
    'ForumPost',
    'Comment',
    'Collage',
    'Post'
  ]),
  targetId: z.number(),
  category: z.string(),
  reason: z.string(),
  evidence: z.string().nullable(),
  status: z.enum(['Open', 'Claimed', 'Resolved']),
  claimedById: z.number().nullable(),
  claimedBy: ReportUser.nullable(),
  claimedAt: z.string().nullable(),
  resolvedById: z.number().nullable(),
  resolvedBy: ReportUser.nullable(),
  resolvedAt: z.string().nullable(),
  resolution: z.string().nullable(),
  resolutionAction: z
    .enum([
      'Dismissed',
      'ContentRemoved',
      'UserWarned',
      'UserDisabled',
      'MetadataFixed',
      'MarkedDuplicate',
      'Other'
    ])
    .nullable(),
  notes: z.array(ReportNoteObj),
  createdAt: z.string(),
  updatedAt: z.string(),
  sourceUrl: z.string().nullable()
});

const ReportSummary = z.object({
  id: z.number(),
  targetType: z.nativeEnum(ReportTargetType),
  targetId: z.number(),
  category: z.string(),
  status: z.nativeEnum(ReportStatus),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  resolution: z.string().nullable(),
  sourceUrl: z.string().nullable()
});

registry.registerPath({
  method: 'get',
  path: '/reports/stats',
  tags: ['Reports'],
  responses: {
    200: {
      description: 'Report resolution statistics',
      content: {
        'application/json': {
          schema: z.object({
            last24h: z.number(),
            lastWeek: z.number(),
            lastMonth: z.number(),
            allTime: z.number(),
            byStaff: z.array(
              z.object({
                userId: z.number(),
                username: z.string(),
                count: z.number()
              })
            )
          })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/reports/counts',
  tags: ['Reports'],
  responses: {
    200: {
      description: 'Open and claimed report counts',
      content: {
        'application/json': {
          schema: z.object({ open: z.number(), claimed: z.number() })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/reports/mine',
  tags: ['Reports'],
  responses: {
    200: {
      description: "User's submitted reports",
      content: {
        'application/json': {
          schema: z.object({
            total: z.number(),
            page: z.number(),
            pageSize: z.number(),
            reports: z.array(ReportSummary)
          })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/reports',
  tags: ['Reports'],
  responses: {
    200: {
      description: 'Paginated staff report queue',
      content: {
        'application/json': {
          schema: z.object({
            total: z.number(),
            page: z.number(),
            pageSize: z.number(),
            reports: z.array(ReportObj)
          })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/reports',
  tags: ['Reports'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: fileReportSchema
        }
      }
    }
  },
  responses: {
    201: {
      description: 'Report created',
      content: { 'application/json': { schema: ReportObj } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/reports/{id}',
  tags: ['Reports'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Report detail',
      content: { 'application/json': { schema: ReportObj } }
    },
    403: msgResponse('Not the reporter and missing reports_manage'),
    404: msgResponse('Report not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/reports/{id}/claim',
  tags: ['Reports'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Claimed' },
    404: msgResponse('Report not found'),
    409: msgResponse('Already claimed by another staff member'),
    422: msgResponse('Already resolved, so there is nothing to claim')
  }
});

registry.registerPath({
  method: 'post',
  path: '/reports/{id}/unclaim',
  tags: ['Reports'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Unclaimed' },
    403: msgResponse(
      'Missing reports_manage, or the report is claimed by another staff member'
    ),
    404: msgResponse('Report not found'),
    422: msgResponse('Not claimed, so there is nothing to release')
  }
});

registry.registerPath({
  method: 'post',
  path: '/reports/{id}/resolve',
  tags: ['Reports'],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: resolveReportSchema
        }
      }
    }
  },
  responses: {
    204: { description: 'Resolved' },
    404: msgResponse('Report not found'),
    422: msgResponse('Already resolved')
  }
});

registry.registerPath({
  method: 'post',
  path: '/reports/{id}/notes',
  tags: ['Reports'],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': { schema: addNoteSchema }
      }
    }
  },
  responses: {
    201: {
      description: 'Note added',
      content: { 'application/json': { schema: ReportNoteObj } }
    },
    404: msgResponse('Report not found')
  }
});

// ─── Ratio Policy ─────────────────────────────────────────────────────────────

const RatioPolicyState = registry.register(
  'RatioPolicyState',
  z.object({
    status: z.enum(['OK', 'WATCH', 'DOWNLOAD_DISABLED']),
    watchStartedAt: z.string().nullable(),
    watchExpiresAt: z.string().nullable(),
    downloadDisabledAt: z.string().nullable(),
    lastEvaluatedAt: z.string()
  })
);

// GET /profile/me/ratio is registered HERE rather than up in the Profile
// section because its response embeds RatioPolicyState, and these consts are
// evaluated in file order — referencing it earlier would hit the temporal dead
// zone. Moving RatioPolicyState up instead would reorder components.schemas in
// openapi.json (they are emitted in registration order), churning stellar-ui's
// vendored copy for no behavioural gain.
const RatioStats = registry.register(
  'RatioStats',
  z.object({
    ratio: z.number(),
    // Serialised from BigInt, so strings rather than numbers.
    contributed: z.string(),
    consumed: z.string(),
    bracket: z.object({
      label: z.string(),
      maxRequired: z.number(),
      minRequired: z.number()
    }),
    eligibleContributionBytes: z.string(),
    contributionCoverage: z.number(),
    requiredRatio: z.number(),
    meetsRequirement: z.boolean()
  })
);

registry.registerPath({
  method: 'get',
  path: '/profile/me/ratio',
  tags: ['Profile'],
  summary: 'Detailed ratio stats for the authenticated member',
  description:
    'The ratio accounting plus the current policy state, in one read. ' +
    '`contributed`, `consumed` and `eligibleContributionBytes` are BigInt ' +
    'columns and serialise as strings.',
  responses: {
    200: {
      description: 'Ratio stats and policy state',
      content: {
        'application/json': {
          schema: RatioStats.extend({ policy: RatioPolicyState })
        }
      }
    },
    404: msgResponse('User not found')
  }
});

registry.registerPath({
  method: 'get',
  path: '/ratio-policy/{userId}',
  tags: ['RatioPolicy'],
  request: { params: z.object({ userId: z.string() }) },
  responses: {
    200: {
      description: "User's ratio policy state",
      content: { 'application/json': { schema: RatioPolicyState } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/ratio-policy/{userId}/override',
  tags: ['RatioPolicy'],
  request: {
    params: z.object({ userId: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: ratioPolicyOverrideSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: 'Override applied',
      content: { 'application/json': { schema: RatioPolicyState } }
    },
    404: msgResponse('User not found')
  }
});

// ─── Site Settings ────────────────────────────────────────────────────────────

const SiteSettings = registry.register(
  'SiteSettings',
  z.object({
    id: z.number(),
    approvedDomains: z.array(z.string()),
    registrationStatus: z.enum(['open', 'invite', 'closed']),
    maxUsers: z.number(),
    // getSettings() and updateSettings() both `upsert` with no `select`, so
    // BOTH routes return the whole SiteSettings row. These two columns are on
    // it and have always been sent; the component simply did not say so.
    // installedAt is `DateTime?` — null until POST /install stamps it.
    dismissedLaunchChecklist: z.array(z.string()),
    installedAt: z.string().nullable(),
    updatedAt: z.string()
  })
);

registry.registerPath({
  method: 'get',
  path: '/settings',
  tags: ['Settings'],
  responses: {
    200: {
      description: 'Site settings',
      content: { 'application/json': { schema: SiteSettings } }
    }
  }
});

registry.registerPath({
  method: 'put',
  path: '/settings',
  tags: ['Settings'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: updateSettingsSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: 'Updated site settings',
      content: { 'application/json': { schema: SiteSettings } }
    }
  }
});

// ─── Top 10 ───────────────────────────────────────────────────────────────────

const Top10Tag = registry.register(
  'Top10Tag',
  z.object({ id: z.number(), name: z.string() })
);

const Top10ReleaseItem = registry.register(
  'Top10ReleaseItem',
  z.object({
    rank: z.number(),
    releaseId: z.number(),
    title: z.string(),
    year: z.number(),
    artistId: z.number(),
    artistName: z.string(),
    type: ReleaseTypeEnum,
    releaseType: ReleaseCategoryEnum,
    tags: z.array(Top10Tag),
    consumerCount: z.number(),
    totalBytesConsumed: z.string(),
    contributionCount: z.number()
  })
);

const Top10UserItem = registry.register(
  'Top10UserItem',
  z.object({
    rank: z.number(),
    userId: z.number(),
    username: z.string(),
    avatar: z.string().nullable(),
    contributed: z.string(),
    consumed: z.string(),
    ratio: z.number(),
    numContributions: z.number(),
    contributionSpeed: z.number(),
    consumeSpeed: z.number(),
    joinedAt: z.string(),
    rankName: z.string(),
    rankLevel: z.number()
  })
);

const Top10TagItem = registry.register(
  'Top10TagItem',
  z.object({
    rank: z.number(),
    tagId: z.number(),
    name: z.string(),
    uses: z.number(),
    positiveVotes: z.number(),
    negativeVotes: z.number()
  })
);

const Top10VoteItem = registry.register(
  'Top10VoteItem',
  z.object({
    rank: z.number(),
    releaseId: z.number(),
    title: z.string(),
    year: z.number(),
    artistName: z.string(),
    ups: z.number(),
    downs: z.number(),
    total: z.number(),
    score: z.number(),
    positivePercent: z.number()
  })
);

const Top10SnapshotEntry = registry.register(
  'Top10SnapshotEntry',
  z.object({
    rank: z.number(),
    releaseId: z.number().nullable(),
    releaseTitle: z.string(),
    tagString: z.string(),
    deleted: z.boolean()
  })
);

const Top10Snapshot = registry.register(
  'Top10Snapshot',
  z.object({
    snapshotId: z.number(),
    type: z.enum(['Daily', 'Weekly']),
    date: z.string(),
    entries: z.array(Top10SnapshotEntry)
  })
);

registry.registerPath({
  method: 'get',
  path: '/top10/releases',
  summary: 'Top releases',
  tags: ['Top10'],
  request: {
    query: z.object({
      type: z
        .enum([
          'day',
          'week',
          'month',
          'year',
          'overall',
          'consumed',
          'contributed'
        ])
        .optional(),
      limit: z.coerce.number().optional(),
      excludeTags: z.string().optional(),
      format: z.string().optional()
    })
  },
  responses: {
    200: {
      description: 'Top releases list',
      content: {
        'application/json': {
          schema: z.object({ items: z.array(Top10ReleaseItem) })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/top10/users',
  summary: 'Top users',
  tags: ['Top10'],
  request: {
    query: z.object({
      type: z
        .enum([
          'contributed',
          'consumed',
          'numContributions',
          'contributionSpeed',
          'consumeSpeed'
        ])
        .optional(),
      limit: z.coerce.number().optional()
    })
  },
  responses: {
    200: {
      description: 'Top users list',
      content: {
        'application/json': {
          schema: z.object({ items: z.array(Top10UserItem) })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/top10/tags',
  summary: 'Top tags',
  tags: ['Top10'],
  request: {
    query: z.object({
      type: z.enum(['used', 'voted']).optional(),
      limit: z.coerce.number().optional()
    })
  },
  responses: {
    200: {
      description: 'Top tags list',
      content: {
        'application/json': {
          schema: z.object({ items: z.array(Top10TagItem) })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/top10/votes',
  summary: 'Top voted releases (BPCI ranked)',
  tags: ['Top10'],
  request: {
    query: z.object({
      limit: z.coerce.number().optional(),
      tags: z.string().optional(),
      year: z.coerce.number().optional()
    })
  },
  responses: {
    200: {
      description: 'Top voted releases',
      content: {
        'application/json': {
          schema: z.object({ items: z.array(Top10VoteItem) })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/top10/history',
  summary: 'Top 10 history snapshot (staff)',
  tags: ['Top10'],
  request: {
    query: z.object({
      type: z.enum(['Daily', 'Weekly']).optional(),
      date: z.string().optional()
    })
  },
  responses: {
    200: {
      description: 'History snapshot',
      content: { 'application/json': { schema: Top10Snapshot } }
    },
    404: {
      description: 'No snapshot found',
      content: { 'application/json': { schema: z.object({ msg: z.string() }) } }
    }
  }
});

// #491 closed the last hand-written request body in this file. This route had
// no validator to reference — it read `req.body?.type` directly — so #490 had
// to transcribe its body by hand. It now runs validate(snapshotSchema) like
// every other mutating route, and this registration references that schema.
// All 21 request bodies are now projections of the validator that enforces them.
registry.registerPath({
  method: 'post',
  path: '/top10/snapshot',
  summary: 'Trigger a history snapshot (admin/cron)',
  description:
    '`type` selects the WINDOW the snapshot captures, not merely the label it ' +
    'is filed under: **Daily is the last 24 hours, Weekly the last 7 days**. ' +
    'Omit the body entirely for a Daily snapshot. Before #491 the window was ' +
    'hardcoded to daily and `type` was stored as a label only, so rows ' +
    'labelled Weekly held daily data.',
  tags: ['Top10'],
  request: {
    body: {
      content: { 'application/json': { schema: snapshotSchema } }
    }
  },
  responses: {
    200: {
      description: 'Snapshot created',
      content: { 'application/json': { schema: z.object({ msg: z.string() }) } }
    },
    400: validationResponse('type is not one of Daily | Weekly')
  }
});

// ─── Rules ────────────────────────────────────────────────────────────────────

const RulesPage = registry.register(
  'RulesPage',
  z.object({
    id: z.number(),
    slug: z.string(),
    title: z.string(),
    body: z.string(),
    isMain: z.boolean(),
    sortOrder: z.number(),
    authorId: z.number(),
    author: z.object({ id: z.number(), username: z.string() }),
    createdAt: z.string(),
    updatedAt: z.string()
  })
);

// PRD-05 #1 — the composable, CRS-weighted rule tree (Rule + nested SubRule).
const SubRule = registry.register(
  'SubRule',
  z.object({
    id: z.number(),
    ruleId: z.number(),
    code: z.string(),
    title: z.string(),
    description: z.string(),
    complianceWeight: z.number(),
    violationWeight: z.number(),
    sortOrder: z.number(),
    createdAt: z.string(),
    updatedAt: z.string()
  })
);

const Rule = registry.register(
  'Rule',
  z.object({
    id: z.number(),
    code: z.string(),
    title: z.string(),
    description: z.string(),
    complianceWeight: z.number(),
    violationWeight: z.number(),
    sortOrder: z.number(),
    subRules: z.array(SubRule),
    createdAt: z.string(),
    updatedAt: z.string()
  })
);

registry.registerPath({
  method: 'get',
  path: '/rules/tree',
  tags: ['Rules'],
  description:
    'The composable Rule/SubRule tree with CRS weights (PRD-05 #1), plus the resolved ${...} variables map (PRD-09 / ADR-0020)',
  responses: {
    200: {
      description:
        'Rule tree (each rule with its nested sub-rules) and the variables map the UI substitutes into the verbatim bodies',
      content: {
        'application/json': {
          schema: z.object({
            rules: z.array(Rule),
            variables: z.record(z.string(), z.string())
          })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/rules',
  tags: ['Rules'],
  responses: {
    200: {
      description: 'Main rules page and sub-pages',
      content: {
        'application/json': {
          schema: z.object({
            main: RulesPage.nullable(),
            pages: z.array(RulesPage)
          })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/rules/{slug}',
  tags: ['Rules'],
  request: { params: z.object({ slug: z.string() }) },
  responses: {
    200: {
      description: 'Single rules page',
      content: { 'application/json': { schema: RulesPage } }
    },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/rules',
  tags: ['Rules'],
  request: {
    body: { content: { 'application/json': { schema: createRulesPageSchema } } }
  },
  responses: {
    201: {
      description: 'Page created',
      content: { 'application/json': { schema: RulesPage } }
    },
    409: msgResponse('Conflict')
  }
});

registry.registerPath({
  method: 'put',
  path: '/rules/{id}',
  tags: ['Rules'],
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: updateRulesPageSchema } } }
  },
  responses: {
    200: {
      description: 'Page updated',
      content: { 'application/json': { schema: RulesPage } }
    },
    404: msgResponse('Not found'),
    // Same conflict POST answers: promoting a page to isMain while another
    // main page exists. The update path checks it too (routes/api/rules.ts),
    // so both routes can answer 409 and only one said so.
    409: msgResponse('A main rules page already exists')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/rules/{id}',
  tags: ['Rules'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Page deleted' },
    400: msgResponse('Cannot delete main page'),
    404: msgResponse('Not found')
  }
});

// ─── Friends ──────────────────────────────────────────────────────────────────

const FriendStatusEnum = z.enum(['pending', 'accepted', 'rejected']);

const UserSummary = registry.register(
  'FriendUserSummary',
  z.object({
    id: z.number(),
    username: z.string(),
    avatar: z.string().nullable()
  })
);

// An accepted friendship as seen by the current user — `friend` is the other party.
const FriendEntry = registry.register(
  'FriendEntry',
  z.object({
    id: z.number(),
    friendId: z.number(),
    comment: z.string(),
    status: FriendStatusEnum,
    createdAt: z.string(),
    friend: UserSummary
  })
);

// An incoming pending request.
const FriendRequest = registry.register(
  'FriendRequest',
  z.object({
    id: z.number(),
    requesterId: z.number(),
    createdAt: z.string(),
    requester: UserSummary
  })
);

// The row returned when a request is sent (still pending).
const FriendRequestSent = registry.register(
  'FriendRequestSent',
  z.object({
    id: z.number(),
    requesterId: z.number(),
    recipientId: z.number(),
    status: FriendStatusEnum,
    createdAt: z.string(),
    recipient: UserSummary
  })
);

registry.registerPath({
  method: 'get',
  path: '/friends',
  tags: ['Friends'],
  summary: 'List accepted friends',
  request: {
    query: z.object({
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().optional()
    })
  },
  responses: {
    200: {
      description: 'Paginated accepted-friends list',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(FriendEntry), meta: PaginationMeta })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/friends/requests',
  tags: ['Friends'],
  summary: 'List incoming pending friend requests',
  request: {
    query: z.object({
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().optional()
    })
  },
  responses: {
    200: {
      description: 'Paginated incoming-requests list',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(FriendRequest),
            meta: PaginationMeta
          })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/friends/status/{userId}',
  tags: ['Friends'],
  summary: 'Relationship status with a user',
  request: { params: z.object({ userId: z.string() }) },
  responses: {
    200: {
      description: 'Friend status',
      content: {
        'application/json': {
          schema: z.object({
            status: z.enum([
              'none',
              'pending_sent',
              'pending_received',
              'accepted',
              'rejected'
            ]),
            isFriend: z.boolean()
          })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/friends/{userId}',
  tags: ['Friends'],
  summary: 'Send a friend request (or accept a reciprocal pending one)',
  request: { params: z.object({ userId: z.string() }) },
  responses: {
    201: {
      description: 'Friend request sent (pending)',
      content: { 'application/json': { schema: FriendRequestSent } }
    },
    200: {
      description:
        'A reciprocal pending request existed and was accepted (now friends)',
      content: { 'application/json': { schema: FriendEntry } }
    },
    400: msgResponse('Cannot add self'),
    404: msgResponse('User not found'),
    409: msgResponse('Already friends or a request is already pending')
  }
});

registry.registerPath({
  method: 'post',
  path: '/friends/{userId}/accept',
  tags: ['Friends'],
  summary: 'Accept a pending request from a user',
  request: { params: z.object({ userId: z.string() }) },
  responses: {
    200: {
      description: 'Request accepted — now friends',
      content: { 'application/json': { schema: FriendEntry } }
    },
    404: msgResponse('No pending request from this user')
  }
});

registry.registerPath({
  method: 'post',
  path: '/friends/{userId}/reject',
  tags: ['Friends'],
  summary: 'Reject a pending request from a user',
  request: { params: z.object({ userId: z.string() }) },
  responses: {
    200: msgResponse('Request rejected'),
    404: msgResponse('No pending request from this user')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/friends/{userId}',
  tags: ['Friends'],
  summary: 'Remove a friend or cancel a request',
  request: { params: z.object({ userId: z.string() }) },
  responses: {
    204: { description: 'Friendship/request removed' }
  }
});

registry.registerPath({
  method: 'put',
  path: '/friends/{userId}/comment',
  tags: ['Friends'],
  summary: 'Set a note on an accepted friendship',
  request: {
    params: z.object({ userId: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: friendCommentSchema
        }
      }
    }
  },
  responses: {
    200: msgResponse('Comment updated'),
    404: msgResponse('Friend not found')
  }
});

// ─── Tag Aliases ──────────────────────────────────────────────────────────────

const TagAliasItem = registry.register(
  'TagAliasItem',
  z.object({
    id: z.number(),
    badTag: z.string(),
    goodTag: z.object({ id: z.number(), name: z.string() }),
    createdBy: StaffUserRef,
    createdAt: z.string()
  })
);

registry.registerPath({
  method: 'get',
  path: '/tag-aliases',
  tags: ['TagAliases'],
  request: {
    query: z.object({ page: z.string().optional() })
  },
  responses: {
    200: {
      description: 'Paginated tag alias list',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(TagAliasItem),
            meta: PaginationMeta
          })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/tag-aliases',
  tags: ['TagAliases'],
  request: {
    body: {
      content: { 'application/json': { schema: createTagAliasSchema } }
    }
  },
  responses: {
    201: {
      description: 'Tag alias created',
      content: { 'application/json': { schema: TagAliasItem } }
    },
    404: msgResponse('Canonical tag not found'),
    409: msgResponse('That tag alias already exists')
  }
});

registry.registerPath({
  method: 'put',
  path: '/tag-aliases/{id}',
  tags: ['TagAliases'],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { 'application/json': { schema: updateTagAliasSchema } }
    }
  },
  responses: {
    200: {
      description: 'Tag alias updated',
      content: { 'application/json': { schema: TagAliasItem } }
    },
    404: msgResponse('Not found'),
    409: msgResponse('That tag alias already exists')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/tag-aliases/{id}',
  tags: ['TagAliases'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Tag alias deleted' },
    404: msgResponse('Not found')
  }
});

// ─── Login Watch / Sessions ───────────────────────────────────────────────────

const SessionItem = registry.register(
  'SessionItem',
  z.object({
    id: z.string(),
    user: StaffUserRef,
    ipAddress: z.string(),
    userAgent: z.string().nullable(),
    createdAt: z.string(),
    lastActiveAt: z.string(),
    revokedAt: z.string().nullable()
  })
);

registry.registerPath({
  method: 'get',
  path: '/users/sessions',
  tags: ['Staff'],
  request: {
    query: z.object({
      page: z.string().optional(),
      userId: z.string().optional()
    })
  },
  responses: {
    200: {
      description: 'Paginated session list',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(SessionItem), meta: PaginationMeta })
        }
      }
    }
  }
});

// ─── Invite Pool ──────────────────────────────────────────────────────────────

const InviteItem = registry.register(
  'InviteItem',
  z.object({
    id: z.number(),
    inviter: StaffUserRef,
    email: z.string(),
    expires: z.string(),
    reason: z.string(),
    status: z.nativeEnum(InviteStatus)
  })
);

registry.registerPath({
  method: 'get',
  path: '/users/invites',
  tags: ['Staff'],
  request: {
    query: z.object({
      page: z.string().optional(),
      status: z.nativeEnum(InviteStatus).optional()
    })
  },
  responses: {
    200: {
      description: 'Paginated invite list',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(InviteItem), meta: PaginationMeta })
        }
      }
    }
  }
});

// ─── Invite Tree ──────────────────────────────────────────────────────────────

const InviteTreeItem = registry.register(
  'InviteTreeItem',
  z.object({
    id: z.number(),
    userId: z.number(),
    // getInviteTree() returns the whole InviteTree row plus two relations, so
    // this column is on the wire and was missing.
    createdAt: z.string(),
    user: StaffUserRef,
    inviterId: z.number().nullable(),
    inviter: StaffUserRef.nullable()
  })
);

registry.registerPath({
  method: 'get',
  path: '/users/invite-tree',
  tags: ['Staff'],
  request: { query: z.object({ page: z.string().optional() }) },
  responses: {
    200: {
      description: 'Paginated invite tree',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(InviteTreeItem),
            meta: PaginationMeta
          })
        }
      }
    }
  }
});

// A member's invite subtree + summary (GET /users/{id}/invite-tree).
const InviteTreeRatioStats = z.object({
  contributed: z.string(),
  consumed: z.string(),
  ratio: z.string()
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MemberInviteTreeNodeSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    userId: z.number(),
    username: z.string(),
    rankName: z.string(),
    isDonor: z.boolean(),
    disabled: z.boolean(),
    depth: z.number(),
    stats: InviteTreeRatioStats.nullable(),
    children: z.array(MemberInviteTreeNodeSchema)
  })
);
const MemberInviteTreeNode = registry.register(
  'MemberInviteTreeNode',
  MemberInviteTreeNodeSchema
);

const InviteTreeSummary = registry.register(
  'InviteTreeSummary',
  z.object({
    entries: z.number(),
    branches: z.number(),
    depth: z.number(),
    disabledCount: z.number(),
    donorCount: z.number(),
    hiddenCount: z.number(),
    byRank: z.array(z.object({ rankName: z.string(), count: z.number() })),
    total: InviteTreeRatioStats,
    topLevel: InviteTreeRatioStats
  })
);

registry.registerPath({
  method: 'get',
  path: '/users/{id}/invite-tree',
  tags: ['Users'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: "A member's invite subtree + summary",
      content: {
        'application/json': {
          schema: z.object({
            tree: z.array(MemberInviteTreeNode),
            summary: InviteTreeSummary
          })
        }
      }
    },
    403: msgResponse('Not the owner and missing invites_manage')
  }
});

// ─── Ratio Watch ──────────────────────────────────────────────────────────────

const RatioWatchItem = registry.register(
  'RatioWatchItem',
  z.object({
    userId: z.number(),
    user: StaffUserRef,
    status: z.nativeEnum(RatioPolicyStatus),
    watchStartedAt: z.string().nullable(),
    watchExpiresAt: z.string().nullable(),
    downloadDisabledAt: z.string().nullable(),
    lastEvaluatedAt: z.string()
  })
);

registry.registerPath({
  method: 'get',
  path: '/users/ratio-watch',
  tags: ['Staff'],
  request: { query: z.object({ page: z.string().optional() }) },
  responses: {
    200: {
      description: 'Paginated ratio watch list',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(RatioWatchItem),
            meta: PaginationMeta
          })
        }
      }
    }
  }
});

// ─── Vanity House ─────────────────────────────────────────────────────────────

const VanityHouseArtist = registry.register(
  'VanityHouseArtist',
  z.object({
    id: z.number(),
    name: z.string(),
    vanityHouse: z.boolean(),
    _count: z.object({ releases: z.number() })
  })
);

registry.registerPath({
  method: 'get',
  path: '/artists/vanity-house',
  tags: ['Staff'],
  request: { query: z.object({ page: z.string().optional() }) },
  responses: {
    200: {
      description: 'Paginated vanity house artists',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(VanityHouseArtist),
            meta: PaginationMeta
          })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'put',
  path: '/artists/{id}/vanity-house',
  tags: ['Staff'],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': { schema: vanityHouseSchema }
      }
    }
  },
  responses: {
    200: {
      description: 'Artist updated',
      content: { 'application/json': { schema: VanityHouseArtist } }
    },
    404: msgResponse('Not found')
  }
});

// ─── Album of the Month ───────────────────────────────────────────────────────

const FeaturedAlbumItem = registry.register(
  'FeaturedAlbumItem',
  z.object({
    id: z.number(),
    groupId: z.number(),
    threadId: z.number(),
    title: z.string(),
    // The list and the create echo both return the whole row, and `image` is a
    // column on it (String @default("")) — it was simply missing here.
    image: z.string(),
    started: z.string(),
    ended: z.string()
  })
);

registry.registerPath({
  method: 'get',
  path: '/announcements/album-of-month',
  tags: ['Announcements'],
  responses: {
    200: {
      description: 'Featured album list',
      content: { 'application/json': { schema: z.array(FeaturedAlbumItem) } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/announcements/album-of-month',
  tags: ['Announcements'],
  request: {
    body: { content: { 'application/json': { schema: featuredAlbumSchema } } }
  },
  responses: {
    201: {
      description: 'Created',
      content: { 'application/json': { schema: FeaturedAlbumItem } }
    }
  }
});

registry.registerPath({
  method: 'delete',
  path: '/announcements/album-of-month/{albumId}',
  tags: ['Announcements'],
  request: { params: z.object({ albumId: z.string() }) },
  responses: {
    204: { description: 'Deleted' },
    404: msgResponse('Not found')
  }
});

// ─── Deleted Collages ─────────────────────────────────────────────────────────

const DeletedCollageItem = registry.register(
  'DeletedCollageItem',
  z.object({
    id: z.number(),
    name: z.string(),
    user: StaffUserRef,
    deletedAt: z.string().nullable(),
    createdAt: z.string()
  })
);

// `descriptionHtml` recurs on every collage response that returns a body: the
// description is stored as BBCode and transcribed at read time (#402), so the
// rendered form is derived, never persisted. It is REQUIRED, not optional —
// list, detail, create, update and recover each add it explicitly, and there is
// no Collage-returning route that omits it. (`/collages/deleted` is the one
// collage read without it, and that has its own DeletedCollageItem.)
const Collage = registry.register(
  'Collage',
  z.object({
    id: z.number().int(),
    name: z.string().max(100),
    description: z.string(),
    descriptionHtml: z.string(),
    userId: z.number().int(),
    categoryId: z.number().int(),
    tags: z.array(z.string()),
    isLocked: z.boolean(),
    isDeleted: z.boolean(),
    maxEntries: z.number().int(),
    maxEntriesPerUser: z.number().int(),
    isFeatured: z.boolean(),
    numEntries: z.number().int(),
    numSubscribers: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
    deletedAt: z.string().nullable(),
    user: z.object({
      id: z.number().int(),
      username: z.string(),
      avatar: z.string().nullable()
    }),
    _count: z.object({
      entries: z.number().int(),
      subscriptions: z.number().int(),
      bookmarks: z.number().int()
    })
  })
);

const CollageEntry = registry.register(
  'CollageEntry',
  z.object({
    id: z.number().int(),
    collageId: z.number().int(),
    releaseId: z.number().int(),
    userId: z.number().int(),
    sort: z.number().int(),
    addedAt: z.string(),
    release: z.object({
      id: z.number().int(),
      title: z.string(),
      image: z.string().nullable(),
      // Both non-nullable columns: `year Int` and `releaseType ReleaseCategory`.
      year: z.number().int(),
      releaseType: ReleaseCategoryEnum,
      // OPTIONAL, and this is the one field where the two selects differ: the
      // detail route selects `communityId`, the add-entry 201 does not. Nullable
      // when it IS selected, because the column itself is `Int?`.
      communityId: z.number().int().nullable().optional(),
      // The stored `credits` array is replaced by this derived display field
      // (modules/releaseCredits withPrimaryArtist) — the Main credit, or the
      // first credit when there is no Main, and genuinely null when a release
      // has no credits at all.
      artist: z.object({ id: z.number().int(), name: z.string() }).nullable()
    }),
    user: z.object({ id: z.number().int(), username: z.string() })
  })
);

const CollageDetail = registry.register(
  'CollageDetail',
  Collage.extend({
    entries: z.array(CollageEntry),
    isSubscribed: z.boolean(),
    isBookmarked: z.boolean()
  })
);

const CollageSubscriber = registry.register(
  'CollageSubscriber',
  z.object({
    userId: z.number().int(),
    collageId: z.number().int(),
    lastVisit: z.string().nullable(),
    user: z.object({ id: z.number().int(), username: z.string() })
  })
);

registry.registerPath({
  method: 'get',
  path: '/collages',
  tags: ['Collages'],
  summary: 'Browse collages',
  description:
    'Personal collages (categoryId 0) are excluded from general browse unless ' +
    'you filter by `userId` or ask for `categoryId=0` explicitly. Deleted ' +
    'collages are never listed here — see GET /collages/deleted.',
  request: { query: collageQuerySchema },
  responses: {
    200: {
      description: 'Paginated collages',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(Collage), meta: PaginationMeta })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/collages',
  tags: ['Collages'],
  summary: 'Create a collage',
  request: {
    body: { content: { 'application/json': { schema: createCollageSchema } } }
  },
  responses: {
    201: {
      description: 'Collage created',
      content: { 'application/json': { schema: Collage } }
    },
    400: validationResponse(
      'Validation error, or a creation rule rejected the request'
    ),
    403: msgResponse('Not permitted to create collages'),
    409: msgResponse('A collage with that name already exists')
  }
});

registry.registerPath({
  method: 'get',
  path: '/collages/{id}',
  tags: ['Collages'],
  summary: 'One collage with its entries and your subscription context',
  description:
    'Entries are ordered by `sort`. `isSubscribed`/`isBookmarked` describe the ' +
    'CALLER, so this response is per-viewer and not cacheable across members. ' +
    'Visiting while subscribed updates your `lastVisit`. Two access rules are ' +
    'worth noting: a DELETED collage answers 404 to non-staff rather than 403, ' +
    'and a PERSONAL collage (categoryId 0) answers 403 to anyone but its owner ' +
    'or staff.',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Collage detail',
      content: { 'application/json': { schema: CollageDetail } }
    },
    403: msgResponse('Personal collage belonging to someone else'),
    404: msgResponse('Not found, or deleted and the caller is not staff')
  }
});

registry.registerPath({
  method: 'put',
  path: '/collages/{id}',
  tags: ['Collages'],
  summary: 'Update a collage',
  description:
    '`isLocked` and the two entry limits are STAFF-ONLY fields: an owner ' +
    'sending them gets 403, distinct from the 403 for editing a collage that ' +
    'is not theirs.',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: updateCollageSchema } } }
  },
  responses: {
    200: {
      description: 'Updated collage',
      content: { 'application/json': { schema: Collage } }
    },
    403: msgResponse(
      'Not the owner or collage staff, or a staff-only field was sent by a non-staff caller (isLocked, maxEntries, maxEntriesPerUser, or name on a public collage)'
    ),
    404: msgResponse('Collage not found'),
    409: msgResponse('Collage name already taken')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/collages/{id}',
  tags: ['Collages'],
  summary: 'Delete a collage',
  description:
    'The deletion is NOT uniform. A PERSONAL collage (categoryId 0) is HARD ' +
    'deleted by its owner or staff and cannot be recovered. A PUBLIC collage ' +
    'is soft-deleted (sets `isDeleted`) and only staff may do it, so an owner ' +
    'who can delete their personal collage gets 403 on a public one; use ' +
    'POST /collages/{id}/recover to restore that case.',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: {
      description: 'Collage deleted — hard if personal, soft if public'
    },
    403: msgResponse(
      'Neither owner nor staff, or a public collage and the caller is not staff'
    ),
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/collages/{id}/recover',
  tags: ['Collages'],
  summary: 'Staff: restore a soft-deleted collage',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Collage restored',
      content: { 'application/json': { schema: Collage } }
    },
    400: msgResponse('The collage is not deleted'),
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/collages/{id}/entries',
  tags: ['Collages'],
  summary: 'Add a release to a collage',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: addEntrySchema } } }
  },
  responses: {
    201: {
      description: 'Entry added',
      content: { 'application/json': { schema: CollageEntry } }
    },
    400: msgResponse(
      'An entry limit was reached — either the collage maximum or your per-user limit'
    ),
    403: msgResponse(
      'The collage is locked, or it is personal and not yours to add to'
    ),
    404: msgResponse('Collage or release not found'),
    409: msgResponse('That release is already in the collage')
  }
});

registry.registerPath({
  method: 'put',
  path: '/collages/{id}/entries',
  tags: ['Collages'],
  summary: 'Reorder the entries of a collage',
  description: 'Send every entry id with its new `sort`.',
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { 'application/json': { schema: reorderEntriesSchema } }
    }
  },
  responses: {
    204: {
      description: 'Entries reordered'
    },
    403: msgResponse('Only the collage owner or staff may reorder entries'),
    404: msgResponse('Collage not found, or deleted')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/collages/{id}/entries/{releaseId}',
  tags: ['Collages'],
  summary: 'Remove a release from a collage',
  description:
    'Addressed by RELEASE id, not entry id — the pair is unique per collage.',
  request: {
    params: z.object({ id: z.string(), releaseId: z.string() })
  },
  responses: {
    204: {
      description: 'Entry removed'
    },
    403: msgResponse(
      'The collage is locked, or the caller is neither the collage owner, the member who added the entry, nor collage staff'
    ),
    404: msgResponse('Collage or entry not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/collages/{id}/subscribe',
  tags: ['Collages'],
  summary: 'Toggle your subscription to a collage',
  description:
    'A TOGGLE despite the name: posting when already subscribed unsubscribes ' +
    'you. The response says which state you ended in.',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Resulting subscription state',
      content: {
        'application/json': {
          schema: z.object({ subscribed: z.boolean() })
        }
      }
    },
    404: msgResponse('Collage not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/collages/{id}/bookmark',
  tags: ['Collages'],
  summary: 'Toggle your bookmark on a collage',
  description: 'A toggle, like /subscribe.',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Resulting bookmark state',
      content: {
        'application/json': {
          schema: z.object({ bookmarked: z.boolean() })
        }
      }
    },
    404: msgResponse('Collage not found')
  }
});

registry.registerPath({
  method: 'get',
  path: '/collages/{id}/subscriptions',
  tags: ['Collages'],
  summary: 'Staff: who is subscribed to a collage',
  description:
    'Requires `collages_moderate`. Ordered by `lastVisit`, most recent first.',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Subscribers',
      content: {
        'application/json': { schema: z.array(CollageSubscriber) }
      }
    },
    404: msgResponse('Collage not found')
  }
});

// ─── Wiki ─────────────────────────────────────────────────────────────────────
//
// Two access levels gate this router, and they answer DIFFERENTLY on purpose:
//
//   minReadLevel  failed -> 404 "Page not found"   (deliberate non-confirmation)
//   minEditLevel  failed -> 403 with a specific message
//
// So a page you may not read is indistinguishable from one that does not exist,
// while a page you may read but not edit tells you plainly that history,
// revision bodies and comparison are closed to you. Revision history, revision
// CONTENT and compare all require the EDIT level, not the read level.

// Three shapes, because routes/api/wiki.ts projects three — NOT the bare Prisma
// model, and not one shape for all six reads:
//
//   PAGE_SELECT            -> WikiPageSummary   the list rows; NO body
//   PAGE_WITH_BODY_SELECT  -> WikiPage          create/update/rollback echoes
//   ... + withBodyHtml()   -> WikiPageRendered  the two direct page reads
//
// The split is load-bearing: `GET /wiki` genuinely cannot serve `body`, and the
// two direct reads always carry `bodyHtml` because they pass the row through
// withBodyHtml() (#398/#402). A single optional-everything schema told the UI
// both of those were maybes.
const WikiPageSummary = registry.register(
  'WikiPageSummary',
  z.object({
    id: z.number().int(),
    title: z.string().max(100),
    slug: z.string().max(50),
    revision: z.number().int(),
    minReadLevel: z.number().int(),
    minEditLevel: z.number().int(),
    authorId: z.number().int(),
    author: z.object({ id: z.number().int(), username: z.string() }),
    createdAt: z.string(),
    updatedAt: z.string(),
    aliases: z.array(
      z.object({
        alias: z.string(),
        userId: z.number().int(),
        createdAt: z.string()
      })
    )
  })
);

// PAGE_WITH_BODY_SELECT — the summary plus the raw BBCode. Returned by the
// three WRITE routes, which respond with the select directly and so carry no
// `bodyHtml`.
const WikiPage = registry.register(
  'WikiPage',
  WikiPageSummary.extend({
    // Raw BBCode. `bodyHtml` is the read-time transcription (#398/#402).
    body: z.string()
  })
);

// What the two DIRECT page reads return: the row put through withBodyHtml(), so
// `bodyHtml` is always present here and never present on WikiPage.
const WikiPageRendered = registry.register(
  'WikiPageRendered',
  WikiPage.extend({
    bodyHtml: z.string(),
    // Only the by-alias route projects this — it selects `deletedAt` to reject
    // a deleted page and then returns the row whole. /wiki/{id} does not, so it
    // is optional rather than always present. It is always null when returned:
    // a deleted page answers 404 before this point.
    deletedAt: z.string().nullable().optional()
  })
);

const WikiRevisionSummary = registry.register(
  'WikiRevisionSummary',
  z.object({
    id: z.number().int(),
    revision: z.number().int(),
    title: z.string(),
    authorId: z.number().int(),
    author: z.object({ id: z.number().int(), username: z.string() }),
    createdAt: z.string()
  })
);

const WikiRevisionContent = registry.register(
  'WikiRevisionContent',
  z.object({
    revision: z.number().int(),
    title: z.string(),
    body: z.string(),
    authorId: z.number().int(),
    author: z.object({ id: z.number().int(), username: z.string() }),
    // When `rev` is the CURRENT revision the live page is returned shaped like
    // a revision, and this carries the page's `updatedAt` rather than a
    // revision row's `createdAt`.
    createdAt: z.string()
  })
);

const WikiCompare = registry.register(
  'WikiCompare',
  z.object({
    pageId: z.number().int(),
    title: z.string(),
    // Never null in a 200: a revision whose body cannot be resolved answers
    // 404 `Revision N not found` before the response is built.
    old: z.object({ revision: z.number().int(), body: z.string() }),
    new: z.object({ revision: z.number().int(), body: z.string() })
  })
);

registry.registerPath({
  method: 'get',
  path: '/wiki',
  tags: ['Wiki'],
  summary: 'Search and list wiki pages',
  request: { query: wikiSearchQuerySchema },
  responses: {
    200: {
      description: 'Paginated pages',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(WikiPageSummary),
            meta: PaginationMeta
          })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/wiki',
  tags: ['Wiki'],
  summary: 'Create a wiki page',
  description:
    'Requires `wiki_edit`, or one of `wiki_manage`/`admin`/`staff`. ' +
    '**`minReadLevel` and `minEditLevel` are forced to 0 unless the caller can ' +
    'MANAGE the wiki** — a plain `wiki_edit` author cannot create a restricted ' +
    'page, and the values they send are ignored rather than rejected.',
  request: {
    body: { content: { 'application/json': { schema: createWikiPageSchema } } }
  },
  responses: {
    201: {
      description: 'Page created',
      content: { 'application/json': { schema: WikiPage } }
    },
    403: msgResponse('Neither wiki_edit nor a managing permission'),
    409: msgResponse('A page with this slug already exists')
  }
});

registry.registerPath({
  method: 'get',
  path: '/wiki/by-alias/{alias}',
  tags: ['Wiki'],
  summary: 'Resolve an alias to its page',
  description:
    'The alias is a SLUG, not an id, and is normalised (lowercased, ' +
    'non-alphanumerics collapsed to hyphens) before lookup.',
  request: { params: z.object({ alias: z.string() }) },
  responses: {
    200: {
      description: 'The aliased page',
      content: { 'application/json': { schema: WikiPageRendered } }
    },
    403: msgResponse('Insufficient rank to view this page'),
    404: msgResponse('No such alias, or the page behind it is deleted')
  }
});

registry.registerPath({
  method: 'get',
  path: '/wiki/{id}',
  tags: ['Wiki'],
  summary: 'One wiki page',
  description:
    'The DIRECT page reads (this and /wiki/by-alias) answer **403** when the ' +
    'page is above the caller read level — they confirm the page exists and ' +
    'say the rank is insufficient. The HISTORY reads (revisions, revision ' +
    'content, compare) answer 404 for the same condition instead. The router ' +
    'is not uniform here; do not infer one from the other.',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Page',
      content: { 'application/json': { schema: WikiPageRendered } }
    },
    403: msgResponse('Insufficient rank to view this page'),
    404: msgResponse('Page not found')
  }
});

registry.registerPath({
  method: 'put',
  path: '/wiki/{id}',
  tags: ['Wiki'],
  summary: 'Update a wiki page',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: updateWikiPageSchema } } }
  },
  responses: {
    200: {
      description: 'Updated page',
      content: { 'application/json': { schema: WikiPage } }
    },
    403: msgResponse('Insufficient permission to edit this page'),
    404: msgResponse('Not found, or above the caller read level'),
    409: msgResponse('The page changed while you were editing, reload')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/wiki/{id}',
  tags: ['Wiki'],
  summary: 'Delete a wiki page',
  description:
    'Gated at the middleware by `wiki_manage` or `admin` — the per-page edit ' +
    'level does not grant deletion.',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: {
      description: 'Page deleted'
    },
    404: msgResponse('Page not found')
  }
});

registry.registerPath({
  method: 'get',
  path: '/wiki/{id}/revisions',
  tags: ['Wiki'],
  summary: 'Revision history for a page',
  description:
    'Requires the page EDIT level, not the read level — being able to read a ' +
    'page does not entitle you to its history.',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'History, newest revision first',
      content: {
        'application/json': {
          schema: z.object({
            currentRevision: z.number().int(),
            revisions: z.array(WikiRevisionSummary)
          })
        }
      }
    },
    403: msgResponse('Insufficient permission to view revision history'),
    404: msgResponse('Not found, or above the caller read level')
  }
});

registry.registerPath({
  method: 'get',
  path: '/wiki/{id}/revisions/{rev}',
  tags: ['Wiki'],
  summary: 'The full body of one revision',
  description:
    'Requires the page EDIT level. Asking for the CURRENT revision returns the ' +
    "live page shaped like a revision, in which case `createdAt` is the page's " +
    "`updatedAt` rather than a revision row's own timestamp.",
  request: {
    params: z.object({ id: z.string(), rev: z.string() })
  },
  responses: {
    200: {
      description: 'Revision content',
      content: { 'application/json': { schema: WikiRevisionContent } }
    },
    403: msgResponse('Insufficient permission to view revision content'),
    404: msgResponse(
      'Page or revision not found, or above the caller read level'
    )
  }
});

registry.registerPath({
  method: 'get',
  path: '/wiki/{id}/compare',
  tags: ['Wiki'],
  summary: 'Compare two revisions of a page',
  description:
    'Requires the page EDIT level. `old` must be strictly less than `new`. ' +
    'Either body comes back null if that revision has no stored body.',
  request: {
    params: z.object({ id: z.string() }),
    query: wikiCompareQuerySchema
  },
  responses: {
    200: {
      description: 'Both revision bodies',
      content: { 'application/json': { schema: WikiCompare } }
    },
    400: msgResponse('`old` must be less than `new`'),
    403: msgResponse('Insufficient permission to compare revisions'),
    404: msgResponse(
      'Page or either revision not found, or above the caller read level'
    )
  }
});

registry.registerPath({
  method: 'post',
  path: '/wiki/{id}/rollback/{rev}',
  tags: ['Wiki'],
  summary: 'Roll a page back to an earlier revision',
  description:
    'Requires the page EDIT level. The rollback is written as a NEW revision ' +
    'rather than by rewinding, so history is never discarded.',
  request: {
    params: z.object({ id: z.string(), rev: z.string() })
  },
  responses: {
    200: {
      description: 'The page after rollback',
      content: { 'application/json': { schema: WikiPage } }
    },
    403: msgResponse('Insufficient permission to edit this page'),
    404: msgResponse('Page or revision not found'),
    409: msgResponse('The page changed while you were rolling back, reload')
  }
});

registry.registerPath({
  method: 'post',
  path: '/wiki/{id}/aliases',
  tags: ['Wiki'],
  summary: 'Add an alias to a page',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: addAliasSchema } } }
  },
  responses: {
    201: {
      description: 'Alias created',
      content: {
        'application/json': { schema: z.object({ alias: z.string() }) }
      }
    },
    400: msgResponse('The alias normalised to nothing usable'),
    403: msgResponse('Insufficient permission to edit this page'),
    404: msgResponse('Page not found'),
    409: msgResponse('That alias is already in use')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/wiki/{id}/aliases/{alias}',
  tags: ['Wiki'],
  summary: 'Remove an alias from a page',
  description: 'The alias is addressed by its slug, which is its primary key.',
  request: {
    params: z.object({ id: z.string(), alias: z.string() })
  },
  responses: {
    204: {
      description: 'Alias removed'
    },
    403: msgResponse('Insufficient permission to edit this page'),
    404: msgResponse('Page not found, or that alias is not on this page')
  }
});

registry.registerPath({
  method: 'get',
  path: '/collages/deleted',
  tags: ['Collages'],
  request: { query: z.object({ page: z.string().optional() }) },
  responses: {
    200: {
      description: 'Paginated deleted collages',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(DeletedCollageItem),
            meta: PaginationMeta
          })
        }
      }
    }
  }
});

// ─── Stats: Economy ───────────────────────────────────────────────────────────

const EconomyGroupedItem = registry.register(
  'EconomyGroupedItem',
  z.object({
    // `reason` is the grouping key of a `groupBy({ by: ['reason'] })` over an
    // `EconomyTransactionReason` COLUMN, so it is the enum, not free text. The
    // earlier enum sweep missed it: that pass matched on field NAMES
    // (type/status/kind/…) and `reason` is free text on six other components,
    // which is exactly why name-matching is not a substitute for reading the
    // column.
    reason: z.nativeEnum(EconomyTransactionReason),
    // BigInt sum, serialized as a string; null when the group is empty.
    _sum: z.object({ amount: z.string().nullable() }),
    _count: z.number()
  })
);

// `recent` is a `findMany` with `include: { user }` and NO `select`, so the
// whole EconomyTransaction row is on the wire — the four context/actor columns
// below were omitted, the same under-description as the siteApi four and
// Notification.userId. `contextId`/`contextType`/`actorUserId` are all nullable
// columns; `userId` is not.
const EconomyTransactionItem = registry.register(
  'EconomyTransactionItem',
  z.object({
    id: z.number(),
    userId: z.number(),
    user: StaffUserRef,
    // BigInt column, serialized as a string.
    amount: z.string(),
    reason: z.nativeEnum(EconomyTransactionReason),
    contextId: z.number().nullable(),
    contextType: z.string().nullable(),
    actorUserId: z.number().nullable(),
    createdAt: z.string()
  })
);

registry.registerPath({
  method: 'get',
  path: '/stats/economy',
  tags: ['Stats'],
  responses: {
    200: {
      description: 'Economy stats',
      content: {
        'application/json': {
          schema: z.object({
            grouped: z.array(EconomyGroupedItem),
            recent: z.array(EconomyTransactionItem)
          })
        }
      }
    }
  }
});

// ─── Stats: Releases ──────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/stats/releases',
  tags: ['Stats'],
  responses: {
    200: {
      description: 'Release and contribution counts',
      content: {
        'application/json': {
          schema: z.object({
            releases: z.number(),
            contributions: z.number(),
            artists: z.number(),
            byType: z.array(z.object({ type: z.string(), _count: z.number() })),
            byLinkStatus: z.array(
              z.object({ linkStatus: z.string(), _count: z.number() })
            )
          })
        }
      }
    }
  }
});

// ─── Stats: Clients ───────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/stats/clients',
  tags: ['Stats'],
  responses: {
    200: {
      description: 'Top user agent strings',
      content: {
        'application/json': {
          schema: z.array(
            z.object({ userAgent: z.string().nullable(), count: z.number() })
          )
        }
      }
    }
  }
});

// ─── Stats: User Flow ─────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/stats/user-flow',
  tags: ['Stats'],
  responses: {
    200: {
      description: 'Invite funnel and snapshot trend',
      content: {
        'application/json': {
          schema: z.object({
            inviteFunnel: z.array(
              z.object({ status: z.string(), _count: z.number() })
            ),
            snapshots: z.array(
              z.object({
                bucketAt: z.string(),
                totalUsers: z.number(),
                activeThisMonth: z.number()
              })
            )
          })
        }
      }
    }
  }
});

// ─── Stats: Site Info ─────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/stats/site-info',
  tags: ['Stats'],
  responses: {
    200: {
      description: 'Aggregate DB counts',
      content: {
        'application/json': {
          schema: z.object({
            totalUsers: z.number(),
            enabledUsers: z.number(),
            disabledUsers: z.number(),
            releases: z.number(),
            artists: z.number(),
            contributions: z.number(),
            communities: z.number(),
            forumTopics: z.number(),
            forumPosts: z.number(),
            collages: z.number(),
            wikiPages: z.number()
          })
        }
      }
    }
  }
});

// ─── DNC (Do Not Contribute) ──────────────────────────────────────────────────

const DncEntrySchema = registry.register(
  'DncEntry',
  z.object({
    id: z.number(),
    name: z.string(),
    comment: z.string(),
    communityId: z.number(),
    userId: z.number(),
    createdAt: z.string(),
    addedBy: z.object({ id: z.number(), username: z.string() }).nullable()
  })
);

registry.registerPath({
  method: 'get',
  path: '/communities/{communityId}/dnc',
  tags: ['Communities'],
  parameters: [
    {
      name: 'communityId',
      in: 'path',
      required: true,
      schema: { type: 'integer' }
    }
  ],
  responses: {
    200: {
      description: 'DNC list for the community',
      content: { 'application/json': { schema: z.array(DncEntrySchema) } }
    },
    403: msgResponse('Not a member of this community'),
    404: msgResponse('Community not found')
  }
});

registry.registerPath({
  method: 'post',
  path: '/communities/{communityId}/dnc',
  tags: ['Communities'],
  parameters: [
    {
      name: 'communityId',
      in: 'path',
      required: true,
      schema: { type: 'integer' }
    }
  ],
  request: {
    body: {
      content: {
        'application/json': {
          schema: dncSchema
        }
      }
    }
  },
  responses: {
    201: {
      description: 'Created DNC entry',
      content: { 'application/json': { schema: DncEntrySchema } }
    },
    404: msgResponse('Community not found')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/communities/{communityId}/dnc/{dncId}',
  tags: ['Communities'],
  parameters: [
    {
      name: 'communityId',
      in: 'path',
      required: true,
      schema: { type: 'integer' }
    },
    { name: 'dncId', in: 'path', required: true, schema: { type: 'integer' } }
  ],
  responses: {
    204: { description: 'Deleted' },
    404: msgResponse('No DNC entry with that id in this community')
  }
});

// ─── Bookmarks ────────────────────────────────────────────────────────────────

const refIdName = z.object({ id: z.number(), name: z.string() });
const refIdUsername = z.object({ id: z.number(), username: z.string() });
const bookmarkToggle = z.object({ bookmarked: z.boolean() });

const artistBookmark = z.object({
  id: z.number(),
  userId: z.number(),
  artistId: z.number(),
  createdAt: z.string(),
  artist: refIdName
});
const releaseBookmark = z.object({
  id: z.number(),
  userId: z.number(),
  releaseId: z.number(),
  sort: z.number(),
  createdAt: z.string(),
  release: z.object({
    id: z.number(),
    communityId: z.number().nullable(),
    title: z.string(),
    artist: refIdName
  })
});
const communityBookmark = z.object({
  id: z.number(),
  userId: z.number(),
  communityId: z.number(),
  sort: z.number(),
  createdAt: z.string(),
  community: refIdName
});
const requestBookmark = z.object({
  id: z.number(),
  userId: z.number(),
  requestId: z.number(),
  createdAt: z.string(),
  request: z.object({ id: z.number(), title: z.string() })
});

/**
 * The three operations each bookmark segment serves, registered once for four
 * segments (#517).
 *
 * The `400` on `post` and `delete` is `validateParams`' — `z.coerce.number()
 * .int().positive()` on the path id, reachable with any non-numeric segment.
 * The `get` has no param to validate and answers nothing beyond its gate, so it
 * sits in `noFailureModes` rather than declaring a code it cannot emit.
 *
 * The `404` on `post` is new (#564). It used to be absent, and this comment used
 * to explain why: a `post` naming a well-formed but nonexistent id hit a
 * foreign-key violation, which carries no `statusCode` and so surfaced as a
 * **500**. The handler now translates P2003, so the code is declarable — the
 * declaration follows the behaviour rather than documenting an intent.
 *
 * `delete` still declares no `404`, and that is not an oversight: it uses
 * `deleteMany`, which no-ops on zero rows and answers `204` whether or not a
 * bookmark was there. The `post` toggle's remove arm uses `deleteMany` for the
 * same reason.
 *
 * No `409` either. A concurrent `post` losing the unique race answers `200`
 * with the resulting state, because the caller asked to bookmark and the
 * bookmark exists — a toggle reports what is true now, not that someone else
 * got there first.
 *
 * That `404`'s noun is passed, not derived from `segment`. Stripping a trailing
 * `s` published `No communitie with that id` for a whole release. English
 * plurals do not invert by rule, and every other description in this file is
 * written out.
 */
const registerBookmark = (
  segment: string,
  paramName: string,
  noun: string,
  item: z.ZodTypeAny
) => {
  registry.registerPath({
    method: 'get',
    path: `/bookmarks/${segment}`,
    tags: ['Bookmarks'],
    responses: {
      200: {
        description: 'Bookmark list',
        content: { 'application/json': { schema: z.array(item) } }
      }
    }
  });
  registry.registerPath({
    method: 'post',
    path: `/bookmarks/${segment}/{${paramName}}`,
    tags: ['Bookmarks'],
    request: { params: z.object({ [paramName]: z.string() }) },
    responses: {
      200: {
        description: 'Toggled bookmark',
        content: { 'application/json': { schema: bookmarkToggle } }
      },
      404: { description: `No ${noun} with that id` }
    }
  });
  registry.registerPath({
    method: 'delete',
    path: `/bookmarks/${segment}/{${paramName}}`,
    tags: ['Bookmarks'],
    request: { params: z.object({ [paramName]: z.string() }) },
    responses: {
      204: { description: 'Removed' }
    }
  });
};

registerBookmark('artists', 'artistId', 'artist', artistBookmark);
registerBookmark('releases', 'releaseId', 'release', releaseBookmark);
registerBookmark('communities', 'communityId', 'community', communityBookmark);
registerBookmark('requests', 'requestId', 'request', requestBookmark);

registry.registerPath({
  method: 'delete',
  path: '/bookmarks/releases/consumed',
  tags: ['Bookmarks'],
  responses: {
    200: {
      description: 'Removed the caller’s release bookmarks they have consumed',
      content: {
        'application/json': {
          schema: z.object({ removed: z.number() })
        }
      }
    }
  }
});

// ─── Random ───────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/random/release',
  tags: ['Random'],
  responses: {
    200: {
      description: 'A random release',
      content: {
        'application/json': {
          schema: z.object({
            id: z.number(),
            communityId: z.number().nullable(),
            title: z.string(),
            year: z.number(),
            artist: refIdName
          })
        }
      }
    },
    404: msgResponse('No releases found')
  }
});

registry.registerPath({
  method: 'get',
  path: '/random/artist',
  tags: ['Random'],
  responses: {
    200: {
      description: 'A random artist',
      content: { 'application/json': { schema: refIdName } }
    },
    404: msgResponse('No artists found')
  }
});

// ─── Search ───────────────────────────────────────────────────────────────────

const releaseSearchItem = z.object({
  id: z.number(),
  title: z.string(),
  year: z.number().nullable(),
  type: ReleaseTypeEnum,
  releaseType: ReleaseCategoryEnum,
  communityId: z.number().nullable(),
  description: z.string(),
  createdAt: z.string(),
  artist: z
    .object({
      id: z.number(),
      name: z.string()
    })
    .nullable(),
  tags: z.array(refIdName),
  _count: z.object({ consumers: z.number(), contributors: z.number() })
});

const artistSearchItem = z.object({
  id: z.number(),
  name: z.string(),
  vanityHouse: z.boolean(),
  tags: z.array(z.object({ tag: refIdName })),
  _count: z.object({ releases: z.number() })
});

const requestSearchItem = z.object({
  id: z.number(),
  title: z.string(),
  description: z.string(),
  type: ReleaseTypeEnum,
  year: z.number().nullable(),
  status: z.nativeEnum(RequestStatus),
  voteCount: z.number(),
  communityId: z.number(),
  createdAt: z.string(),
  user: refIdUsername,
  community: refIdName.optional(),
  artists: z.array(z.object({ artist: refIdName })),
  totalBounty: z.string(),
  _count: z.object({ bounties: z.number() })
});

const topicSearchItem = z.object({
  id: z.number(),
  title: z.string(),
  createdAt: z.string(),
  isLocked: z.boolean(),
  isSticky: z.boolean(),
  numPosts: z.number(),
  forumId: z.number(),
  author: refIdUsername
});

const postSearchItem = z.object({
  id: z.number(),
  body: z.string(),
  createdAt: z.string(),
  forumTopicId: z.number(),
  author: refIdUsername
});

const userSearchItem = z.object({
  id: z.number(),
  username: z.string(),
  createdAt: z.string(),
  userRank: z.object({ name: z.string(), color: z.string().nullable() }),
  email: z.string().optional(),
  lastLogin: z.string().nullable().optional(),
  disabled: z.boolean().optional(),
  ratio: z.number().nullable().optional(),
  contributed: z.string().optional(),
  consumed: z.string().optional()
});

const paged = (item: z.ZodTypeAny) =>
  z.object({ data: z.array(item), meta: PaginationMeta });

registry.registerPath({
  method: 'get',
  path: '/search/releases',
  tags: ['Search'],
  request: { query: searchReleasesQuerySchema },
  responses: {
    200: {
      description: 'Release search results',
      content: { 'application/json': { schema: paged(releaseSearchItem) } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/search/artists',
  tags: ['Search'],
  request: { query: searchArtistsQuerySchema },
  responses: {
    200: {
      description: 'Artist search results',
      content: { 'application/json': { schema: paged(artistSearchItem) } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/search/requests',
  tags: ['Search'],
  request: { query: searchRequestsQuerySchema },
  responses: {
    200: {
      description: 'Request search results',
      content: { 'application/json': { schema: paged(requestSearchItem) } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/search/log',
  tags: ['Search'],
  request: { query: searchLogQuerySchema },
  responses: {
    200: {
      description: 'Forum log search results',
      content: {
        'application/json': {
          schema: z.union([
            paged(topicSearchItem),
            paged(postSearchItem),
            z.object({
              topics: paged(topicSearchItem),
              posts: paged(postSearchItem)
            })
          ])
        }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/search/users',
  tags: ['Search'],
  request: { query: searchUsersQuerySchema },
  responses: {
    200: {
      description: 'User search results',
      content: { 'application/json': { schema: paged(userSearchItem) } }
    }
  }
});

// ─── Site history ─────────────────────────────────────────────────────────────

const siteHistoryBase = z.object({
  id: z.number(),
  authorId: z.number(),
  title: z.string(),
  body: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});
const siteHistoryEntry = siteHistoryBase.extend({ author: refIdUsername });
const siteHistoryBody = z.object({ title: z.string(), body: z.string() });

registry.registerPath({
  method: 'get',
  path: '/site-history',
  tags: ['Site history'],
  responses: {
    200: {
      description: 'Site history entries',
      content: { 'application/json': { schema: z.array(siteHistoryEntry) } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/site-history',
  tags: ['Site history'],
  request: {
    body: { content: { 'application/json': { schema: siteHistoryBody } } }
  },
  responses: {
    201: {
      description: 'Created entry',
      content: { 'application/json': { schema: siteHistoryBase } }
    }
  }
});

registry.registerPath({
  method: 'put',
  path: '/site-history/{id}',
  tags: ['Site history'],
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: siteHistoryBody } } }
  },
  responses: {
    200: {
      description: 'Updated entry',
      content: { 'application/json': { schema: siteHistoryBase } }
    },
    404: msgResponse('Not found')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/site-history/{id}',
  tags: ['Site history'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Deleted' },
    404: msgResponse('Not found')
  }
});

// ─── Downloads ────────────────────────────────────────────────────────────────

const grantResult = z.object({
  grantId: z.number(),
  downloadUrl: z.string(),
  amountBytes: z.string(),
  status: z.nativeEnum(DownloadGrantStatus),
  createdAt: z.string()
});

registry.registerPath({
  method: 'post',
  path: '/contributions/{id}/access',
  tags: ['Downloads'],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: grantAccessSchema
        }
      }
    }
  },
  description:
    'Grants download access and debits the ratio ledger, so most of what can ' +
    'go wrong is accounting rather than addressing. Two conditions answer ' +
    '400 beyond body validation, both `{ msg }`: the contribution has no ' +
    'approved accounting size, and the caller has insufficient contributed ' +
    'balance. A FREEPASS or NEUTRALPASS exemption skips the balance check ' +
    'entirely. Repeating the call inside the idempotency window returns the ' +
    'existing grant rather than charging twice.',
  responses: {
    200: {
      description: 'Download access granted',
      content: { 'application/json': { schema: grantResult } }
    },
    403: msgResponse(
      'Cannot consume your own contribution, or download access is disabled'
    ),
    404: msgResponse('Contribution not found'),
    409: msgResponse('Balance changed concurrently — retry')
  }
});

registry.registerPath({
  method: 'get',
  path: '/contributions/{id}/access/latest',
  tags: ['Downloads'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Most recent grant within the idempotency window',
      content: { 'application/json': { schema: grantResult } }
    },
    404: msgResponse('No recent grant')
  }
});

registry.registerPath({
  method: 'post',
  path: '/downloads/{grantId}/reverse',
  tags: ['Downloads'],
  request: {
    params: z.object({ grantId: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: reverseGrantSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: 'Grant reversed',
      content: {
        'application/json': {
          schema: z.object({ grantId: z.number(), status: z.string() })
        }
      }
    },
    404: msgResponse('Grant not found'),
    409: msgResponse('Grant is not in COMPLETED state — already reversed')
  }
});

// ─── Donations ────────────────────────────────────────────────────────────────

const donationItem = z.object({
  id: z.number(),
  userId: z.number(),
  amount: z.number(),
  email: z.string(),
  donatedAt: z.string(),
  currency: z.string(),
  source: z.string(),
  reason: z.string(),
  user: refIdUsername
});

registry.registerPath({
  method: 'get',
  path: '/donations',
  tags: ['Donations'],
  request: { query: z.object({ userId: z.string().optional() }) },
  responses: {
    200: {
      description: 'Donation log',
      content: { 'application/json': { schema: paged(donationItem) } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/donations',
  tags: ['Donations'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: createDonationSchema
        }
      }
    }
  },
  responses: {
    201: {
      description: 'Donation recorded',
      content: { 'application/json': { schema: donationItem } }
    },
    404: msgResponse('User not found')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/donations/{id}',
  tags: ['Donations'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Deleted' },
    404: msgResponse('Not found')
  }
});

// ─── Bad passwords (denylist) ────────────────────────────────────────────────

const badPasswordItem = z.object({
  id: z.number(),
  password: z.string(),
  source: z.enum(['SEEDED', 'STAFF'])
});
const badPasswordBody = z.object({ password: z.string().min(6).max(255) });

registry.registerPath({
  method: 'get',
  path: '/bad-passwords',
  tags: ['Bad passwords'],
  request: {
    query: z.object({
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().optional()
    })
  },
  responses: {
    200: {
      description: 'Paginated password denylist',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(badPasswordItem),
            meta: PaginationMeta
          })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/bad-passwords',
  tags: ['Bad passwords'],
  request: {
    body: { content: { 'application/json': { schema: badPasswordBody } } }
  },
  responses: {
    201: {
      description: 'Created entry',
      content: { 'application/json': { schema: badPasswordItem } }
    },
    409: msgResponse('Password is already denied')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/bad-passwords/{id}',
  tags: ['Bad passwords'],
  request: { params: z.object({ id: z.coerce.number().int().positive() }) },
  responses: {
    204: { description: 'Entry removed' },
    404: msgResponse('Entry not found')
  }
});

// ─── Email blacklist ──────────────────────────────────────────────────────────

const emailBlacklistItem = z.object({
  id: z.number(),
  userId: z.number(),
  email: z.string(),
  addedAt: z.string(),
  comment: z.string()
});
const emailBlacklistBody = z.object({
  email: z.string(),
  comment: z.string()
});

registry.registerPath({
  method: 'get',
  path: '/email-blacklist',
  tags: ['Email blacklist'],
  responses: {
    200: {
      description: 'Blacklisted emails',
      content: { 'application/json': { schema: z.array(emailBlacklistItem) } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/email-blacklist',
  tags: ['Email blacklist'],
  request: {
    body: { content: { 'application/json': { schema: emailBlacklistBody } } }
  },
  responses: {
    201: {
      description: 'Created entry',
      content: { 'application/json': { schema: emailBlacklistItem } }
    },
    400: validationResponse('Entry is neither an email address nor a domain')
  }
});

registry.registerPath({
  method: 'delete',
  path: '/email-blacklist/{id}',
  tags: ['Email blacklist'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Deleted' },
    404: msgResponse('Not found')
  }
});

// ─── IP bans ──────────────────────────────────────────────────────────────────

const ipBanItem = z.object({
  id: z.number(),
  fromIp: z.string(),
  toIp: z.string()
});
const ipBanBody = z.object({
  fromIp: z.string(),
  toIp: z.string().optional()
});

registry.registerPath({
  method: 'get',
  path: '/ip-bans',
  tags: ['IP bans'],
  responses: {
    200: {
      description: 'IP bans',
      content: { 'application/json': { schema: z.array(ipBanItem) } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/ip-bans',
  tags: ['IP bans'],
  request: {
    body: { content: { 'application/json': { schema: ipBanBody } } }
  },
  responses: {
    201: {
      description: 'Created ban',
      content: { 'application/json': { schema: ipBanItem } }
    },
    400: validationResponse(
      'Invalid IP address, reversed bounds, or a range spanning both address families'
    )
  }
});

registry.registerPath({
  method: 'delete',
  path: '/ip-bans/{id}',
  tags: ['IP bans'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Deleted' },
    404: msgResponse('Not found')
  }
});

// ─── Log checker ──────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/log-check',
  tags: ['Contribute'],
  summary: 'Score a pasted EAC/XLD rip log (0–100; 100 = verified perfect)',
  request: {
    body: {
      content: { 'application/json': { schema: logCheckRequestSchema } }
    }
  },
  responses: {
    200: {
      description: 'Scored log',
      content: { 'application/json': { schema: logCheckResultSchema } }
    },
    400: validationResponse('Invalid request body')
  }
});

// ─── Document builder ─────────────────────────────────────────────────────────

type JsonRecord = Record<string, unknown>;

// zod-to-openapi's OpenAPI 3.0 codegen for `X.nullable()` on a *registered*
// schema renders `{ allOf: [ref, { nullable: true }] }` — the nullable flag
// as its own array member rather than a sibling of `allOf`. That's not the
// standard OpenAPI 3.0 nullable-ref idiom (`{ allOf: [ref], nullable: true }`,
// flag as a sibling of the array); openapi-typescript reads the malformed
// shape as an untyped extra branch and silently drops `null` from the
// generated type (#295). Reshape post-generation instead of hand-duplicating
// every affected schema at its use site.
function isNullableRefWorkaround(
  value: unknown
): value is { allOf: [unknown, JsonRecord] } {
  if (!value || typeof value !== 'object') return false;
  const { allOf } = value as JsonRecord;
  if (!Array.isArray(allOf) || allOf.length !== 2) return false;
  const second = allOf[1];
  return (
    !!second &&
    typeof second === 'object' &&
    Object.keys(second as JsonRecord).length === 1 &&
    (second as JsonRecord).nullable === true
  );
}

function fixNullableRef(value: unknown): unknown {
  if (isNullableRefWorkaround(value)) {
    return { allOf: [value.allOf[0]], nullable: true };
  }
  return value;
}

function normalizeNullableRefsDeep(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(normalizeNullableRefsDeep);
  }
  if (node && typeof node === 'object') {
    const fixed = fixNullableRef(node);
    if (fixed !== node) {
      return fixed;
    }
    const result: JsonRecord = {};
    for (const [key, val] of Object.entries(node as JsonRecord)) {
      result[key] = normalizeNullableRefsDeep(val);
    }
    return result;
  }
  return node;
}

/**
 * The two credentials this API actually accepts (#520).
 *
 * Before this, `components.securitySchemes` was **absent entirely** while 112
 * operations referenced schemes by name — every one of those references
 * dangling. Worse, the references were inverted: 70 operations declared
 * `bearerAuth` while being gated by `requireAuth`, which reads a **cookie** and
 * has no `Authorization` path at all, and the only three routes that genuinely
 * take a bearer token declared nothing.
 */
const SECURITY_SCHEMES = {
  cookieAuth: {
    type: 'apiKey' as const,
    in: 'cookie' as const,
    name: 'token',
    description:
      'Session JWT, set as an HttpOnly cookie by `POST /auth`. This is what ' +
      '`requireAuth` reads; there is no Authorization-header equivalent.'
  },
  serviceKey: {
    type: 'http' as const,
    scheme: 'bearer' as const,
    description:
      'The shared `STELLAR_SERVICE_KEY`, presented by korin.pink on its ' +
      'inbound calls (ADR-0013). An opaque secret, not a user token — a ' +
      "member's session JWT is not accepted here."
  }
};

/**
 * The `security` block a route's gates imply.
 *
 * Derived rather than declared, because the gates already know. `routeGate.ts`
 * stamps every gate as `auth | permission | service` for the #494 coverage
 * check, and that same stamp answers "with what credential?" — so this cannot
 * drift from the middleware the way 309 of 364 hand-written blocks had.
 *
 * `auth` and `permission` collapse deliberately: both present the same cookie,
 * and the difference between them is 401 versus 403, which lives in
 * `responses` already. Encoding it twice in two vocabularies is how the two
 * drift apart.
 */
export const securityForGates = (
  gates: readonly Gate[] | undefined
): { [scheme: string]: string[] }[] | undefined => {
  // NOT EVERY GATE IS A CREDENTIAL. A rate limiter rejects a caller who
  // presented perfectly good credentials, or none at all where none are needed,
  // so it says nothing about what to authenticate with. Before this filter,
  // stamping the site-wide write limiter (#553) put `cookieAuth` on
  // `POST /auth/register` and five other public endpoints — the contract
  // asserting a session requirement that does not exist.
  //
  // A `validation` gate is the same case and was added knowing it (#567):
  // `POST /auth/register` validates its body and needs no session, so an
  // unfiltered list would have reintroduced the identical bug on a far wider
  // blast radius — 269 routes run a validator, and 95 of them are public.
  const NOT_CREDENTIALS: readonly GateKind[] = ['rateLimit', 'validation'];
  const credentials = (gates ?? []).filter(
    (gate) => !NOT_CREDENTIALS.includes(gate.kind)
  );
  if (credentials.length === 0) return undefined;
  if (credentials.some((gate) => gate.kind === 'service'))
    return [{ serviceKey: [] }];
  return [{ cookieAuth: [] }];
};

/**
 * Which part of the request a route's validators cover, as prose.
 *
 * A route running two validators carries two gates, so the targets union. The
 * order is fixed (path, then query, then body) rather than following mount
 * order, because a description that varied with middleware ordering would churn
 * `openapi.json` for a change that alters no behaviour.
 */
const validationFailureDescription = (gates: readonly Gate[]): string => {
  const targets = new Set(
    gates.flatMap((gate) =>
      gate.kind === 'validation' ? (gate.targets ?? []) : []
    )
  );
  const parts = [
    targets.has('params') ? 'path' : undefined,
    targets.has('query') ? 'query' : undefined
  ].filter((part): part is string => part !== undefined);

  // Always plural: the schema covers the whole of `req.params` or `req.query`,
  // not one field, and a route with a single path segment can still fail on it
  // for several reasons at once.
  const params =
    parts.length > 0 ? `Invalid ${parts.join(' or ')} parameters` : undefined;

  if (targets.has('body')) {
    return params ? `${params} or request body` : 'Invalid request body';
  }
  // A validation gate with no target cannot happen through the three factories,
  // but a hand-stamped one could; say the generic thing rather than nothing.
  return params ?? 'Validation error';
};

/**
 * How a gate's own refusal reads in the contract.
 *
 * The strings are the ones 495 hand-written blocks had converged on already, so
 * this is a promotion of the existing convention rather than a new vocabulary.
 * All 356 `401`s read `Not authenticated` or, on the three service routes,
 * `Missing or wrong service key`; 136 of 139 `403`s read `Missing <perm>`.
 *
 * These describe the CONDITION, not the body. Every one of these refusals
 * sends `{ msg: 'Permission denied' }` or similar; what a reader needs from
 * the contract is which permission would have let the call through.
 *
 * A `permission` gate carrying no names is the one case with no precedent to
 * follow, because none exists today. It gets the generic wording, since naming
 * nothing is exactly what `requireOwnerOrPermission` means: an owner passes
 * without any permission at all.
 */
const gateFailureDescription = (
  gates: readonly Gate[],
  code: 400 | 401 | 403 | 429
): string => {
  // The limiter's own body is `{ msg: 'Too many requests, …' }`; this describes
  // the condition, as every other entry here does.
  if (code === 429) return 'Rate limited';
  // Which part of the request failed to parse. A caller sent a bad path
  // segment and a caller sent a bad payload have different problems, and the
  // 79 hand-written blocks this replaces called both `Validation error`.
  if (code === 400) return validationFailureDescription(gates);
  if (code === 401)
    return gates.some((gate) => gate.kind === 'service')
      ? 'Missing or wrong service key'
      : 'Not authenticated';
  const permissions = [
    ...new Set(gates.flatMap((gate) => gate.permissions ?? []))
  ];
  return permissions.length > 0
    ? `Missing ${permissions.join(' or ')}`
    : 'Permission denied';
};

/**
 * The `responses` entries a route's gates imply, keyed by status code.
 *
 * The sibling of `securityForGates`, and the same argument (#517). `security`
 * stopped being hand-written because the gates already knew the answer; the
 * `401` and `403` beside it were still written out 495 times, and #494's whole
 * gate existed to police that hand-writing.
 *
 * Derivation obviates the police work. A gate cannot forget to document the
 * code it answers, so there is no gap left to measure.
 *
 * What this does NOT cover is a `403` the HANDLER throws — `Not your
 * stylesheet`, `Account disabled`, `Not the recipient`. Those have no gate to
 * read and stay registered by hand, which is the axis #517 tracks.
 */
export const responsesForGates = (
  gates: readonly Gate[] | undefined,
  method: string
): Record<string, ReturnType<typeof msgResponse>> => {
  if (!gates || gates.length === 0) return {};
  // THE BODY IS NOT UNIFORM. Three of these codes send `{ msg }`; the
  // validation 400 sends `{ msg, errors }`. stellar-ui generates its service
  // types from this document, so emitting `MsgResponse` here would propagate a
  // type asserting `errors` does not exist, on 170 operations at once (#567).
  const bodyFor = (code: number) =>
    code === 400 ? validationResponse : msgResponse;

  return Object.fromEntries(
    expectedCodes(gates, method).map((code) => [
      String(code),
      bodyFor(code)(
        gateFailureDescription(gates, code as 400 | 401 | 403 | 429)
      )
    ])
  );
};

/**
 * An operation's `responses`, with the gate-implied entries filled in.
 *
 * REGISTERED WINS. Derivation only supplies a code the registration omits, so
 * a route needing bespoke wording keeps it by writing it down. Two do:
 * `GET /asset/{hash}` explains why an asset read needs a session at all, and
 * `POST /reports/{id}/unclaim` folds its gate and its handler into one entry
 * (`Missing reports_manage, or the report is claimed by another staff member`)
 * because a caller cannot tell the two 403s apart.
 *
 * Keys come back in ascending numeric order, which is the order every
 * registration was already written in. Appending the derived codes instead
 * would reorder `openapi.json` for 356 operations and bury the real change.
 */
const withGateResponses = (
  responses: Record<string, unknown> | undefined,
  gates: readonly Gate[] | undefined,
  method: string
): Record<string, unknown> => {
  const merged = { ...responsesForGates(gates, method), ...(responses ?? {}) };
  return Object.fromEntries(
    Object.entries(merged).sort(([a], [b]) => Number(a) - Number(b))
  );
};

/** An operation, in the only two respects the gates have anything to say about. */
type DerivedOperation = { security?: unknown; responses?: unknown };

/**
 * Write `security` and the gate-implied failure responses onto every operation.
 *
 * Done in one pass over the built document rather than per `registerPath()`, so
 * there is exactly one place either can be wrong — and it is a place that reads
 * the middleware instead of restating it. 309 of 364 `security` blocks had
 * drifted from their own gates before #520 moved them here, and the 401/403
 * beside them were still hand-written 495 times before #517 followed.
 */
const applyGateDerivations = (
  paths: Record<string, unknown>,
  routes: readonly Operation[]
): void => {
  const gatesByOp = new Map<string, readonly Gate[] | undefined>(
    routes.map((r) => [`${r.method.toUpperCase()} ${r.path}`, r.gates])
  );

  for (const [path, item] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(
      item as Record<string, DerivedOperation>
    )) {
      if (!op || typeof op !== 'object') continue;
      const gates = gatesByOp.get(`${method.toUpperCase()} ${path}`);

      const security = securityForGates(gates);
      if (security) op.security = security;
      else delete op.security;

      op.responses = withGateResponses(
        op.responses as Record<string, unknown> | undefined,
        gates,
        method
      );
    }
  }
};

/**
 * @param routes every contract route the mounted app serves, with its gates.
 *   **Required**, so a document cannot be built without deriving `security`.
 *   An optional parameter would let the served `/api/docs/json` and the
 *   committed `openapi.json` disagree, and nothing compares that pair.
 */
export function buildOpenApiDocument(routes: readonly Operation[]) {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  const doc = generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'Stellar API',
      version: appVersion,
      // The IP-ban 403 is stated ONCE, here, rather than on all 364
      // operations. `rejectBannedIps` runs before routing, so every operation
      // can emit it and none of them owns it — declaring it per-operation
      // would be accurate in a literal sense and would drown the
      // per-operation distinctions the derived 401/403 exist to draw. OpenAPI
      // has no top-level `responses` to say it in, so prose is the only place
      // it can go (#517).
      description:
        'REST API for the Stellar community tracker. All routes under `/api/*`. ' +
        'Authentication uses JWT cookies (`token` cookie set on login). ' +
        'Separately from any per-operation failure documented below, **every** ' +
        'endpoint can answer `403` with ' +
        '`{ msg: "Access from this network is not permitted" }` when the ' +
        "caller's IP is banned: that check runs before routing and applies " +
        'even to endpoints needing no session.'
    },
    servers: [{ url: '/api', description: 'API server' }]
  });

  // The generator owns `components`, so the schemes are attached to the built
  // document rather than passed into the config.
  doc.components = {
    ...(doc.components ?? {}),
    securitySchemes: SECURITY_SCHEMES
  };

  // Only PublicProfile and MyProfile (which spreads PublicProfile.shape) hit
  // the nullable-ref registered-schema path (#295) — scope the reshape to
  // those instead of walking the whole document.
  const schemas = doc.components?.schemas;
  if (schemas) {
    for (const name of ['PublicProfile', 'MyProfile'] as const) {
      const schema = schemas[name];
      if (schema) {
        schemas[name] = normalizeNullableRefsDeep(schema) as typeof schema;
      }
    }
  }

  applyGateDerivations(doc.paths ?? {}, routes);

  return doc;
}
