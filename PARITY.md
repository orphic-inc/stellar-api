# Stellar ↔ Gazelle Feature Parity

Legend: ✅ complete | 🔧 backend only | 🎨 frontend only | ❌ not started | N/A not applicable

Audit notes (2026-05-21):
- This file previously overstated several gaps. Invite tree, privacy controls, PM drafts, staff canned responses, collage comments, and comment subscription UI are implemented.
- Bonus points are permanently deferred from the current launch scope.
- Forum post edit history UI is complete. Public forum post payloads now expose only `lastEdit` attribution; moderator-only revision bodies load from a dedicated endpoint instead of being embedded in the thread payload.
- Account recovery admin flow is complete. Stellar's recovery is standard forgot-password (not legacy-tracker migration as in Gazelle), so the staff queue shows pending/used/expired tokens rather than a claim/approve/deny evidence-review workflow. Staff can revoke pending tokens from the queue, and admins can trigger recovery emails directly from the user profile panel. OpenAPI spec updated for the three new user endpoints; frontend types regenerated.

Audit notes (2026-05-22):
- Tag voting is complete. The implicit Prisma many-to-many release-tag relation was replaced with explicit ReleaseTag and ReleaseTagVote models. POST /:releaseId/tags/:tagId/vote; tag deletion now requires communities_manage. ReleaseHistory added to audit all release changes.
- Personal collage limits are complete. `personalCollageLimit` on `UserRank` (0 = unlimited); enforced in POST /api/collages for the personal category; staff/admin bypass, collages_moderate does not. Seeded as User=1 / Power User=2 / Staff=3 / SysOp=4 on fresh installs; existing installs default to 0 and must be configured via the admin rank form. Counter and submit gate added to the collage create form.

## Auth & Account

| Feature | Status | Notes |
|---------|--------|-------|
| Login / logout | ✅ | Cookie-based JWT, session tracked |
| Register (open / invite-only) | ✅ | registrationStatus setting honored |
| Change password | ✅ | POST /api/auth/password |
| Change email | ✅ | PUT /api/auth/email + UserEmailHistory |
| Account recovery (self-service) | ✅ | token flow, 2h TTL |
| Session list / revoke | ✅ | GET/DELETE /api/auth/sessions |
| 2FA / TOTP | ❌ | nice-to-have |
| Paranoia / privacy settings | ✅ | privacy fields persisted in UserSettings and enforced in profile projection; implemented as coarse flags + paranoia level rather than Gazelle's serialized paranoia array |

## User Management

| Feature | Status | Notes |
|---------|--------|-------|
| Profile view / edit | ✅ | /api/profile/me, /api/profile/user/:id |
| User settings | ✅ | GET/PUT /api/users/settings |
| Staff: ip/email history | ✅ | |
| Staff: disable / enable | ✅ | POST /api/users/:id/disable\|enable |
| Staff: warn user | ✅ | POST /api/users/:id/warn + UserWarning |
| Staff: moderation notes | ✅ | GET/POST/DELETE /api/users/:id/notes |
| Staff: set rank | ✅ | PUT /api/users/:id/rank |
| Donor ranks admin CRUD | ✅ | GET/POST/PUT/DELETE /api/users/donor-ranks |
| Grant / revoke donor | ✅ | POST/DELETE /api/users/:id/donor |
| Invite system (send, use) | ✅ | /api/profile/:id/invites, register flow |
| Invite tree visualization | ✅ | profile payload includes `inviteTree`; frontend route/component renders it |
| Snatch list | ✅ | GET /api/users/me/snatch-list |
| Account recovery admin queue | ✅ | GET/DELETE /api/users/recovery-requests + POST /api/users/:id/recovery; queue page at /private/staff/tools/recovery-queue; trigger-recovery button on user profile; deviation from Gazelle: token-based monitoring queue (not claim/approve/invite flow — no legacy migration) |

## Releases / Contributions

| Feature | Status | Notes |
|---------|--------|-------|
| Browse releases (search, filter) | ✅ | /api/search + community releases |
| Release detail | ✅ | /api/communities/:cid/releases/:rid |
| Release create / edit / delete | ✅ | via contributions |
| Tag system (add/remove) | ✅ | tag routes on artist |
| Tag voting | ✅ | POST /:releaseId/tags/:tagId/vote; ReleaseTag/ReleaseTagVote models with score tracking |
| Cover art management | ❌ | image field exists, no dedicated upload |
| Edit history / revision log | ✅ | ReleaseHistory audits create, edit, tag add/remove, contribution added |
| Random release | ✅ | GET /api/random |
| Vanity house releases | 🔧 | isVanityHouse field, home.ts exposes it |

## Requests & Bounties

| Feature | Status | Notes |
|---------|--------|-------|
| List / search requests | ✅ | GET /api/requests |
| Create / edit / delete request | ✅ | full CRUD |
| Add bounty (vote) | ✅ | POST /api/requests/:id/bounty |
| Fill request | ✅ | POST /api/requests/:id/fill |
| Unfill request | ✅ | POST /api/requests/:id/unfill |
| Notify requester + voters on fill | ✅ | emits request_filled notifications |

## Notifications & Subscriptions

| Feature | Status | Notes |
|---------|--------|-------|
| Forum subscription (subscribe/unsubscribe) | ✅ | Subscription model |
| Forum post → notify subscribers | ✅ | forum.ts fires createMany (type: forum_sub) |
| Forum quote → notify quoted user | ✅ | type: forum_quote |
| Comment subscription (subscribe/unsubscribe) | ✅ | comment subscription routes + UI present on commentable surfaces |
| Comment posted → notify comment subscribers | ✅ | comments.ts fires (type: comment_sub) |
| Collage subscription (subscribe/unsubscribe) | ✅ | CollageSubscription model + route |
| Collage entry added → notify subscribers | ✅ | collages.ts fires (type: collage_updated) |
| Request filled → notify requester + voters | ✅ | requests.ts fires (type: request_filled) |
| PM unread indicator | ✅ | MessageParticipant.unreadCount in NotificationCorner |
| Artist subscription (follow/unfollow) | ✅ | ArtistSubscription model + GET/POST/DELETE /:id/subscribe |
| New-contribution → notify followers | ✅ | artist_release notification on contribution creation |
| Notification bell — per-type text | ✅ | NotificationCorner renderNotificationText |
| Mark read / delete / mark all read | ✅ | |

## Messaging

| Feature | Status | Notes |
|---------|--------|-------|
| PM inbox / sent / conversation | ✅ | full CRUD |
| Unread count | ✅ | |
| Bulk operations | ✅ | POST /api/messages/bulk-update |
| Search PMs | ✅ | query param |
| PM drafts | ✅ | GET/POST/PUT/DELETE `/api/messages/drafts` + ComposeForm/DraftsPage |
| Forward message | ❌ | no route |
| Staff inbox (tickets) | ✅ | full CRUD |
| Staff inbox scoreboard | ✅ | |
| Staff canned responses | ✅ | `/api/staff-inbox/responses` + CannedResponsesPage/TicketView integration |
| Staff PM (staff-to-staff) | 🔧 | staffPm.ts module + routes, no UI |

## Forums

| Feature | Status | Notes |
|---------|--------|-------|
| Forum / category CRUD | ✅ | |
| Topic CRUD (create, lock, sticky, delete) | ✅ | |
| Post CRUD (create, edit, delete) | ✅ | |
| Post edit history | ✅ | inline last-edited marker for all readers; staff-only revision history in ForumTopicPost |
| Polls (create, vote) | ✅ | |
| Topic notes (staff) | ✅ | |
| Last-read tracking | ✅ | |
| Class-level read/write gates | ✅ | minClassRead/Write enforced |

## Artists

| Feature | Status | Notes |
|---------|--------|-------|
| Artist profile | ✅ | GET /api/communities/:cid/artist/:id |
| Artist CRUD | ✅ | create/update/delete |
| Artist history / reverts | ✅ | |
| Similar artists | ✅ | add/remove/vote |
| Artist aliases | ✅ | |
| Artist tags | ✅ | |
| Artist subscription ("follow") | ✅ | ArtistSubscription model + subscribe/unsubscribe/status routes; follow button on ArtistPage |
| New-release notification to followers | ✅ | artist_release emitted on contribution creation; rendered in NotificationCorner |

## Collages

| Feature | Status | Notes |
|---------|--------|-------|
| Collage CRUD | ✅ | |
| Collage entries (add/remove/sort) | ✅ | |
| Subscribe / unsubscribe | ✅ | GET/POST in collages route |
| Entry added → notify subscribers | ✅ | emits collage_updated notifications |
| Collage comments | ✅ | shared comments route supports `page=collages`; CollageDetail renders CommentsSection |
| Personal collages (class limit) | ✅ | `personalCollageLimit` on `UserRank` (0 = unlimited); staff/admin bypass; seeded User=1/PU=2/Staff=3/SysOp=4 |

## Wiki

| Feature | Status | Notes |
|---------|--------|-------|
| Article CRUD + soft-delete | ✅ | |
| Revision history + compare | ✅ | |
| Aliases | ✅ | |
| Permission levels (minRead, minEdit) | ✅ | |
| Full-text search | ✅ | |

## Reports

| Feature | Status | Notes |
|---------|--------|-------|
| File report (user-submitted) | ✅ | |
| Staff queue (claim/unclaim/resolve) | ✅ | |
| Staff notes | ✅ | |
| Report stats | ✅ | |

## Bookmarks

| Feature | Status | Notes |
|---------|--------|-------|
| Artist / release / collage / request bookmarks | ✅ | all 4 types |
| Bulk remove snatched | ❌ | nice-to-have |

## Stats & Charts

| Feature | Status | Notes |
|---------|--------|-------|
| Site stats | ✅ | |
| Top 10 (releases, users, tags) | ✅ | TTL-cached + snapshots |
| Historical stats | ❌ | nice-to-have |

## Site History / Audit Log

| Feature | Status | Notes |
|---------|--------|-------|
| Searchable audit log | ✅ | |

## Search

| Feature | Status | Notes |
|---------|--------|-------|
| Cross-domain search | ✅ | GET /api/search |
| Full-text (DB LIKE) | ✅ | |
| Sphinx / advanced FTS | ❌ | nice-to-have post-launch |

## Bonus Economy

| Feature | Status | Notes |
|---------|--------|-------|
| Bonus point balance | ❌ | no model, no route |
| Earn points (contribute/seed events) | ❌ | not started |
| Bonus point history | ❌ | not started |
| Bonus store (tokens, invites, titles) | ❌ | not started |
| EconomyTransaction ledger | 🔧 | immutable ledger exists and is used for download grant debit/credit/reversal flows; no bonus-facing routes or history yet |

## Miscellaneous

| Feature | Status | Notes |
|---------|--------|-------|
| Downloads / access grants | ✅ | |
| Announcements | ✅ | |
| Posts (blog) | ✅ | |
| Site settings (admin) | ✅ | |
| Stylesheet / theme per user | 🔧 | route exists, frontend may not use it |
| Applications / staff roles | ❌ | Applicant stub model |
| Friends system | ❌ | stub model |
| Staff directory | ❌ | nice-to-have |

---

## Priority Queue

### Launch-blocking

(none — all launch-blocking items resolved)

### Quick wins (backend done, just needs UI)

1. PARITY tracker cleanup — several rows below still need periodic revalidation as features land so the queue stays trustworthy
2. Staff PM scoreboard/review pass — verify current implementation against Gazelle workflow before scheduling follow-up work

### Nice-to-have

1. Historical stats
2. Applications / staff roles, friends system, and staff directory
3. 2FA / TOTP


### Implement once primary funcitonality is complete
1. Stylesheet / theme application (settings persist, but the client does not apply site appearance or external stylesheet globally)