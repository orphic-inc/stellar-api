# Changelog

All notable changes to stellar-api are documented here.

---

## [Unreleased]

## [0.6.0] — 2026-06-23

### Added

- **CRS dimensions — PRD-01's formula filled out.** Invite + Donation dimensions complete the v0.0.x set [#61, #62]; a signed, contribution-gated **CommunityScore**, quality-weighted so a lossless/logged/cued rip pulls more than a transcode [#75, #76, ADR-0017]; **CRS time-series snapshots** as the trend layer [#94, ADR-0007]; and a **lifetime link-health** dimension (`R × (1 − e^(−H/τ))`, PASS-only accrual) [#95, ADR-0019].
- **Automated user-class progression — full rollout** atop the 0.5.6 evaluator: `RankPromotionRule` + `User.rankLocked` schema [#167], ladder + rule seed [#168], a background sweep job with promote/demote notifications [#169], and `RankPromotionRule` CRUD + per-user progression endpoint [#170, #171].
- **Friends lifecycle** — request/accept, mutual-friend detection, and standardized response contracts [#60, PRD-01].
- **Golden Rules** — a 6-rule canonical tree seeded from `CODE_OF_CONDUCT.md` with read-time `${…}` variable resolution and `GET /api/rules/tree` [#215, PRD-09, ADR-0020].
- **CommunityLeader role** — a scalar `Community.leaderId` (a superset of staff), transfer via `PUT /communities/:id`, seeded for the flagship community at install [#216, #217, #221, ADR-0021].
- **Install state recorded as a fact**, not inferred from row counts [ADR-0022].
- **Verified IRC nick link** — challenge/nonce proof-of-control for `User.ircNick`; only a verified link credits IRCScore or resolves the korin nick→account lookup. User-facing route now registered [#175, #198, #201, ADR-0015].
- **Per-ReleaseType upload size caps** [#93].
- **Paranoia-gated community-stats profile block** — friends count, invite summary, and reputation view on the profile (PRD-01 Profile Integration).
- **Version-consistency guardrail** across the manifest, `/health`, and OpenAPI surfaces [#79].

### Changed

- **Trunk-only CI** — workflows off the retired staging/develop branches; widened the format gate to `prisma/**/*.ts` [#224].
- **PM contributors** when a contribution link is swept WARN→FAIL [#125].

### Fixed

- Install seed URL port corrected to `:9000` (the UI dev server).
- Regenerated `docs/erd.md` to sync the irc-nick nonce fields.
- Raised the devTools integration hook timeout to stop a flake [#165].

### Docs / Governance

- **PRD-01 CRS dimension roadmap** — the nine live dimensions plus the scoped additions (ContributionScore, Leadership, Contests, Concerts) and the governing decisions [#230].
- ForumRules/StaffRules documented as built [#126]; **ADR-0018** development lifecycle + the enforced API/UI contract gate, with the OpenAPI freshness gate de-inerted (now tracking `openapi.json`) [#204] and issue/PR templates + a security-review gate; **ADR-0016** consumption-accounting & ratio-gate contract; **PRD-02** reconciled to korin.pink [#163]; Freepass/Neutralpass settled; `CODE_OF_CONDUCT` + `SECURITY` added; a cross-repo CONTEXT-MAP + multi-context agent-skills config.

## [0.5.6] - 2026-06-17

### Added

- **Automated user-class progression — pure evaluator** — `src/modules/rankProgression.ts`: a pure, table-driven engine (`evaluateRankChange`) that decides whether a member promotes one step, demotes one step, or stays, given their stats and the rule set, plus `describeGapToNext` for a member-facing "progress to next class" widget. Encodes one-step-per-pass climbing, stock-only demotion (ratio drift and account age never demote), demotion-takes-precedence-over-promotion on the prestige tiers, and rankLocked / active-warning / Staff-SysOp guards. No DB or I/O — 20 unit specs, built test-first. The data-model migration, ladder seed, sweep job, and admin/member UI are tracked as rollout slices [#167, #168, #169, #170, #171]; product decisions gating the seed are in [#172].
- **Schema ERD as committed documentation** — `prisma-erd-generator` renders a Mermaid `docs/erd.md` (regenerated on `prisma generate` and `npm run db:erd`), guarded by a CI "ERD freshness" drift-check; the Docker image build is scoped to the client generator so the dev-only ERD generator can't break it [#176].

### Removed

- **Legacy duplicate `TopTenLeaderboard` model** — a dead twin of the live `Top10Snapshot` / `top10.ts` board (it carried legacy `lastTorrent*` columns); removed the model plus a `DROP TABLE` migration [#176].

### Docs

- **ADR-0002** noted as snapshot-shipped (v0.5.5) [#166].

## [0.5.5] — 2026-06-16

### Added

- **Contribution submission parity** — `POST /contributions` now accepts the full legacy upload-form metadata: release category (Album/Single/EP/…), record label, catalogue number, and edition info (title/year/remaster), persisting them to the `Release`/`Edition` tier. Each collaborator is credited as a role-typed `ReleaseArtist` (Main/Guest/Remixer/…, mapped case-insensitively) instead of only the first artist as Main [#72].
- `GET /health` now reports the running API `version`, sourced from the manifest via `lib/version.ts`.
- **IRC reputation via korin.pink** — `User.ircNick` (unique, nullable) links a Stellar account to an Ergo nick through `PUT /api/users/:id/irc-nick` (self or admin; 409 on conflict). The IRCScore CRS dimension (`activity × consistency × channelQuality`, cap 6) is computed read-time from metrics polled from the external korin.pink irc-bridge — `src/modules/irc.ts` client + `src/modules/ircJob.ts` poll job (default 5 min via `KORIN_POLL_INTERVAL_MS`; inert when `KORIN_API_URL`/`KORIN_PULL_KEY` are unset). This **supersedes and removes the in-repo IRC build** (delegated Ergo SASL callback, `IrcActivity` rollup, per-user IRC/Announce keys) [ADR-0013].
- `prisma/scripts/seed-wiki-irc-community.ts` — seeds 6 korin.pink IRC community wiki pages (intro, overview, connecting, channel directory, etiquette, IRCScore). Idempotent; skips existing slugs. Run: `npm run db:seed-wiki`.
- **Authored stylesheets** — members can save a named `AuthorStylesheet` [#118] and adopt another member's sheet, crediting the author through a deduped CRS accrual (one credit per distinct adopter→author pair, enforced by a partial unique index) [#119, #120].
- **Governance model (PRD-05)** — a composable `Rule`/`SubRule` tree with per-node compliance/violation weights plus a pure, table-driven `ruleImpact()` scorer (`GET /api/rules/tree`) [#123]; and a read-time `computeStanding()` that rolls active `UserWarning` rows + ban state into a 5-tier standing surfaced on the profile [#124, ADR-0004].
- **Invite tree** — an adjacency model with recursive subtree read, exposed per member at `GET /api/users/:id/invite-tree` returning `{ tree, summary }`: recursive nodes (per-node ratio stats, donor/disabled/depth) and a rollup summary (entries, branches, depth, by-rank counts, totals) [#61].
- **Community health snapshots** — the read-time link-health pulse is now persisted as a time series (`CommunityHealthSnapshot`, per community × period × bucket), captured by the stats job at Daily/Monthly/Yearly cadence mirroring the user/site snapshots, and read via `GET /api/communities/:id/health/history?period=`. A shared `computePulse` single-sources the banding for the live pulse and the snapshot [#75]. _(Folding the pulse into a CommunityScore CRS dimension stays deferred — #75.)_
- **Friends × Stylesheet controlled vector** — adopting another member's stylesheet now also accrues a bounded, additive nudge in the Friends CRS dimension (adopter ×0.2 / author ×0.1), capped separately so plain friending stays the stronger signal and mass adoption flattens out [#147, PRD-03].

### Fixed

- OpenAPI `info.version` is now derived from the manifest (`lib/version.ts`) instead of a hardcoded `0.1.0` — the Swagger doc was advertising a version three minor releases stale.

### Security

- Hardened `cssSanitize` against a CSS-escape bypass on stored `AuthorStylesheet` content — escaped sequences could smuggle past the store-time sanitizer [#152].

### Docs

- Accepted **ADR-0003** (stylesheet injection isolation) and **ADR-0004** (standing → CRS).
- Split Donations into its own **PRD-07** and added **PRD-08** (Collages & Cover Art); normalized the per-PRD numbering index across all PRDs; added a prose-conventions section to `docs/home.md`.

### Internal

- Widened `format`/`lint` to cover `prisma/**/*.ts`.

---

## [0.5.4] — 2026-06-10

### Added

- **Community Reputation Score (CRS)** — a reputation registry with Longevity, Ratio (one-way ratio → reputation), and Friends (bounded trust signal) dimensions, exposed via `GET /me/reputation` [PRD-01].
- **Community link-health pulse** — a coverage-gated health endpoint that treats WARN as indeterminate [ADR-0002].
- **Stylesheet management** — admin routes, stats, and `isDefault` enforcement; pure stylesheet-selection CRS scoring [PRD-03]; bundled themes (Layer Cake, Proton, Postmod).
- **Edition tier + multi-artist credits** for the music model (see Changed) [#72].
- Decision records: ADRs 0002–0009 and PRDs 01/03/04/05/06; `AGENTS.md`; expanded `CONTEXT.md` / `README.md` covering CRS, ratio, the music model, stylesheets, governance, and fork workflow.

### Changed

- **Music model**: releases now credit artists through a role-typed `ReleaseArtist` join (multi-artist) instead of a single artist reference. Edition metadata — record label, catalogue number, media, and edition flag — moved to a dedicated `Edition` tier, and contribution `bitrate`/`media` became typed enums. List, detail, and search responses keep a stable `artist` field derived from the primary (Main) credit via a shared `releaseCredits` helper [#72, #98].
- `/api/search/releases`: artist and vanity-house filters now traverse the credits relation; record label, catalogue number, and media filters traverse the edition relation; `bitrate`/`media` query params are validated as enums (exact match).
- **Ratio**: eligible-contribution relief is now gated on link health, with a 72h WARN→FAIL sweep and `linkStatusChangedAt` tracking [ADR-0006].
- Remove Gravatar dependency — registration and install no longer compute a Gravatar URL from the user's email (which leaked an email hash to a third party; unacceptable for a private site). New users register with a null avatar; the UI falls back to a bundled default.
- devTools seeded users store a null avatar and fall back to the shared default in the UI, like real null-avatar accounts. (Reverts an earlier `'seeded'` sentinel / hardcoded `seeded.jpg` path that rendered broken — no UI mapper existed and no such asset is served.)
- Bumped Prisma 5.3.1 → 6.19.3 and pinned the Docker base image.

### Fixed

- Contributions: store `sizeInBytes` as `BIGINT` to stop INT4 overflow.
- Integration suite: repaired four consumers stranded by the music remodel — collages/downloads release credits, the downloads edition FK, vanityHouse `_count`, and the devTools cleanup sweep (`ReleaseArtist`/`Edition`).
- `requestId` typed via the Express request augmentation [#78].

### Security

- Restored `externalStylesheet` URL validation on the profile-update schema — it accepted an arbitrary string while the user endpoint required a URL, an input-validation regression on a shared UI injection point.

### Internal

- CI now type-checks test files (`tsconfig.test.json`); `*.integration.ts` / `*.spec.ts` type errors previously surfaced only at runtime. Added staging/develop branch CI support.

### Migration

- `prisma/scripts/backfill-remove-gravatar-avatars.ts` — one-off backfill nulling existing stored Gravatar avatar URLs. Run manually: `npx ts-node prisma/scripts/backfill-remove-gravatar-avatars.ts`.
- Music-model expand→contract migrations — **DESTRUCTIVE** on a populated database (requires #73/#74 backfill first); safe as-is on fresh / CI databases.

### Stub tracking

- Issues filed for friends (#60), invite tree (#61), and donations (#62).

---

## [0.5.3] — 2026-06-01

### Added

- CI: staging and develop branch workflows

### Changed

- `collages.ts`: inline permission checks at all call sites, removing `isStaffOrModerator` named role helper (ADR-0001 compliance) — eliminates double DB lookup on GET `/:id`

### Fixed

- devTools generators: expanded offset space to eliminate cross-run unique constraint collisions on seeded usernames

---

## [0.5.2] — 2026-05-30

### Added

- Sentry error reporting integration
- Structured security event logging (failed logins, 403s, 429s)
- Health check endpoint with graceful shutdown and request logging
- BBCode parser for profile rendering
- `FeaturedAlbum.image` field wired through home endpoint and AOTM create
- CI checks: lint, format, OpenAPI freshness

### Changed

- Business logic extracted from user and auth route handlers into domain modules
- Seed generator byte accounting fixed; devTools generator offset space expanded
- Rate limiting expanded to all write endpoints and download grants
- Integration test coverage: contributions, downloads, PM, permission loading

### Fixed

- Forum trash handling, BBCode Prettier conflicts, integration timeouts
- Report source URLs for Artist and Comment target types
- Sentry type lint error
- Test suite flakiness: persistent supertest server, worker force-exit, empty setup stub removed

---

## [0.5.1] — 2026-05-28

### Changed

- Release backend refactored into workbench modules
- Forum topic model deepened: `topicSession` module and session endpoint
- Request lifecycle deepened: detail, vote, history, and auth moved into module
- Pagination deepened: `paginationBase`, `parsedPage`, `validateQuery` on all list routes
- `registerUser` deepened: invite gate and consumption moved into module
- `isModerator` replaced with granular permission checks at all call sites (ADR-0001)

### Added

- `GET /tools/user-ranks/permissions` endpoint; static `permissionCatalog` duplicate removed
- Missing OpenAPI specs; forum topic trash endpoint

### Fixed

- Integration test calls to `registerUser` after options-object refactor
- Release workbench lint issues
- DownloadAccessGrant FK fields and cleanup ordering

---

## [0.5.0] — 2026-05-19

### Added

- Comprehensive unit test coverage across all API routes and modules
- Permissions middleware spec; comment schema cross-page validation tests
- Coverage for: auth, PM, forum, top10, communities, reports, requests, collages, wiki, search, downloads, notifications, bookmarks, posts, profile, announcements, settings, tools, subscriptions, stats, home, stylesheet, random, user, artist, DNU, poll

### Fixed

- Comment targets for contributions and requests
- Reports module mock completeness
- Test suite Prettier formatting

---

## [0.4.99] — 2026-05-27 _(alias: v0.4.9)_

### Added

- Staff toolbox: generate test data API (Phases A–C) — user, community, release, forum, wiki, moderation generators seeded from real music library data and publicly available packaging data rates

---

## [0.4.9] — 2026-05-17

### Added

- Top 10 leaderboards with TTL caching and snapshot persistence
- Release voting and tag management

### Changed

- `upload`/`download` renamed to `contribute`/`consume` throughout (domain language alignment)
- Staff PMs bifurcated from user private conversations into dedicated staff inbox

---

## [0.3.9] — 2026-05-17

### Added

- **Economy**: download grants, ratio calculation, ratio watch state machine, link health checks and approval workflow, requests/bounty system
- **Communities**: download URLs, domain gate via SiteSettings, per-community `allowDuplicateFormats`
- **Collages**: full CRUD with personal collage limits per user rank
- **PM + Staff Inbox**: private messaging system; support tickets unified with PM conversations
- **Reports**: content moderation and reporting system
- **Wiki**: API with revision history, aliases, and page comparison
- **Search**: cross-domain search and random release endpoints
- **Profile**: aggregate visibility controls, donor presentation, staff surfaces; accepts username or numeric ID
- **Bookmarks**: artist, release, community, request bookmark CRUD
- **Site history**, DNU list management, moderation tooling, donor ranks
- **Auth payload**: contribute/consume/ratio stats included on login
- **Notifications**: subscription events, request fills, read-tracking
- **Ratio policy**: staff override routes with OpenAPI contracts
- Dev QoL: lint-staged, seed script, Dockerfile improvements

### Fixed

- Boolean query-param parsing in report and ticket queues
- Five UX bugs in ticket workflow
- Install flow: survive DB resets; launch checklist handling
- Feature drift: auth, communities, reports, and email bug fixes

---

## [0.3.4] — 2026-04-24 _(Phase 4)_

### Fixed

- `parsedParams` ESLint import conflict reverted and reworked
- DOMPurify mock converted to TypeScript
- Integration script and Codacy parsing errors

---

## [0.3.3] — 2026-04-23 _(Phase 3)_

### Added

- DB-backed integration test harness
- Codacy artifact exclusions

---

## [0.3.2] — 2026-04-23 _(Phase 2)_

### Changed

- Business logic extracted from route files into service modules (auth, stats, comment, artist)
- `AuthenticatedRequest` introduced; `req.user!` assertions eliminated
- Error envelope fully standardized: `{ msg }` replaces legacy `{ errors: [] }` shape
- Mutation response contracts normalized across posts, forum, announcements
- Parsed body and parsed params rolled out across all handlers
- Forum logic fully extracted to modules; OpenAPI schema gaps filled

### Fixed

- `Post.comments` and `ForumPost.edits` normalized from JSON to relational tables
- 30-day audit fixes: batch collaborator upsert, `express-validator` removed

---

## [0.3.1] — 2026-04-23 _(Phase 1)_ _(alias: v0.4.1)_

### Changed

- Full audit remediation: C1–C7, H1–H6, M1–M7, L1–L4
- Routes reorganized from `sections/` into domain-based directory structure
- `install.ts` schemas split into domain schema files
- Error envelope standardized; auth middleware hardened
- Zod validation added to 8 previously unvalidated mutating handlers
- `installLimiter` wired; missing CRUD operations completed
- Audit log model and trail wired to admin/mod actions
- Transaction boundaries added; moderator overrides on forum mutations
- HTML sanitization on all free-text input fields
- Pagination added to all unbounded list endpoints
- Codacy ESLint warnings resolved; `package-lock.json` tracked

---

## [0.3.0] — 2026-04-23

### Added

- Jest API contract coverage (domain-split)
- Workflow actions pinned; CI test setup hardened

---

## [0.2.5] — 2026-04-23

### Added

- `validateParams` and `validateQuery` helpers — reusable param/query validation
- Param validation rolled out: forum topics, forum posts, communities routes
- Homepage featured content and hardened poll reads
- Profile contracts and invite tree documented in OpenAPI
- Artist, forum, stats, announcements, notifications OpenAPI expansion

### Fixed

- Forum auth guards and install OpenAPI sync

---

## [0.2.0] — 2026-04-23

### Added

- Prisma-backed installation flow and API routes
- `GET /api/stats` endpoint
- Audit hardening: core infra, permissions, auth, Zod validation, rate limiting
- `AuditLog` model wired to admin and mod actions
- Transaction boundaries on forum topic/post mutations
- HTML sanitization on all free-text inputs
- Pagination on list endpoints
- Artist DELETE and full announcements CRUD

### Changed

- Routes reorganized into domain-based directories
- Schemas split by domain
- Error envelope standardized (P5/P6)
- `express-validator` replaced with Zod

### Fixed

- Poll field sanitization; 201 status codes corrected
- Codacy ESLint warnings resolved

_Commits: `1e48a45` `06e4a61` `db95fc6` `3320608` `8f056e9` `c3d2568` (+ `52e9a04` `77665dc`)_

---

## [0.1.0] — 2026-04-22

### Added

- Full Prisma schema with stub models: User, Community, Artist, Release, Tag, enums
- Relational fields: consumer/contributor/invite stubs
- User route scaffolding and Prisma connection
- Docker image publish workflow; `.dockerignore`
- Dev environment setup guide and skeleton README
- Web server and Dockerfile

### Changed

- Converted codebase to TypeScript
- Environment variable names unified across UI and API
- Config keys and logging type errors resolved

---

## [0.0.1] — 2024-02-14

### Added

- Initial import: project scaffolding, config, formatting baseline

---

[Unreleased]: https://github.com/orphic-inc/stellar-api/compare/v0.5.4...HEAD
[0.5.4]: https://github.com/orphic-inc/stellar-api/compare/v0.5.3...v0.5.4
[0.5.3]: https://github.com/orphic-inc/stellar-api/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/orphic-inc/stellar-api/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/orphic-inc/stellar-api/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/orphic-inc/stellar-api/compare/v0.4.99...v0.5.0
[0.4.99]: https://github.com/orphic-inc/stellar-api/compare/v0.4.9...v0.4.99
[0.4.9]: https://github.com/orphic-inc/stellar-api/compare/v0.3.9...v0.4.9
[0.3.9]: https://github.com/orphic-inc/stellar-api/compare/v0.3.4...v0.3.9
[0.3.4]: https://github.com/orphic-inc/stellar-api/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/orphic-inc/stellar-api/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/orphic-inc/stellar-api/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/orphic-inc/stellar-api/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/orphic-inc/stellar-api/compare/v0.2.5...v0.3.0
[0.2.5]: https://github.com/orphic-inc/stellar-api/compare/v0.2.0...v0.2.5
[0.2.0]: https://github.com/orphic-inc/stellar-api/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/orphic-inc/stellar-api/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/orphic-inc/stellar-api/releases/tag/v0.0.1
