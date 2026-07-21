# Changelog

All notable changes to stellar-api are documented here.

---

## [Unreleased]

### Added

- **Stylesheet asset upload — Phase 2 of the asset store** ([ADR-0026](docs/adr/0026-static-asset-storage.md), #342) — the substrate from #290 gets the piece it was built for: an author can now upload the background images their stylesheet references. `POST /api/asset` takes a raw image body (identified by magic bytes, not the client's declared type), gated by a new per-rank `UserRank.assetLimit` count that scales up the ladder like `personalCollageLimit` — a brand-new User uploads nothing (`0`), the allowance grows with rank, and staff are uncapped (`null`). Fonts stay seeder-only: the upload path is image-only, which is what stops a member wiring an uploaded face into `@font-face` and reviving the #343 redistribution question as user-generated content. Delivery is derived from ownership rather than a status column — a site-shipped fixture (`ownerId` null) serves unauthenticated and cacheable `public`, a member upload requires auth and caches `private` — so the two can never drift and there is no illegal "public-but-owned" state to represent. A daily sweep collects member assets that no stylesheet references and that are past a 24h grace window; site assets are never swept.

  Scope was deliberately narrowed during a design review: avatars, which had ridden along as a partial #361 fix, moved to their own issue (#396) so this stays a single-lens infra change. The design settled one new column (`assetLimit`) where an earlier draft had five schema changes.

- **Full-shape profile percentile tiles** (#280) — the percentile block reported where a member ranks on each dimension but not the value that put them there, so a tile could say "top 4%" with nothing to anchor it. Each dimension now carries its `raw` contributing value alongside the percentile, gated by the same paranoia rules as the stat itself: a hidden contributed/consumed figure returns `raw: null` while its percentile stays visible, which is the disclosure the block already made. Adds an `artistsAdded` dimension — attributed to the author of an artist's earliest history row, since artists have no creator column — and an `overall` composite, the weighted mean of the dimensions scaled by `min(ratio, 1)` so consumption can't be out-volumed. The weights are provisional and documented at the constant; a bounty-style dimension has no analog until the deferred economy lands.

- **Binary asset store** ([ADR-0026](docs/adr/0026-static-asset-storage.md), #290 Phase 1) — an api-owned home for the binary assets a stored row references, so an asset is verifiable from the api that serves it rather than living unverified in another repo's static tree. An `Asset` row (content hash, mime, size, kind, optional owner) holds the bytes in Postgres, and `GET /api/asset/:hash` delivers them addressed by sha256: non-enumerable, deduplicated by content, and cacheable as genuinely `immutable` since the bytes at a hash can never change. Ingest identifies every payload by its magic bytes and rejects anything empty, oversize, unrecognized, or whose declared mime contradicts its content — the store never serves a byte it has not identified. `STELLAR_ASSET_MAX_BYTES` (default 2 MB) caps a single asset.

  This is the substrate only. The authenticated upload path, reference counting / orphan sweep, and the migration of the asset-bearing themes (`proton`, `postmod`) to api-canonical `/css` fixtures are all still open — see the ADR amendment for the two blockers found while building it.

- **Store-time CSS boundary** ([ADR-0031](docs/adr/0031-injected-css-threat-model.md), #360) — `lib/cssValidate.ts` implements the threat model's instrument: it detects and rejects rather than cleansing, and stores the author's bytes verbatim. `url()` narrows to `/api/asset/<sha256>` and relative paths, and `data:` is removed for everyone — it was the content-smuggling vector and no shipped theme used it. Every violation is reported with its rule and location instead of only the first, so an author fixing a sheet sees the whole set. Replaces the previous cleanse-don't-reject posture, which is what corrupted escaped identifiers (#340): a detector that only answers yes/no can normalize freely because it never writes.

- **`proton` migrated to an api-canonical `/css` fixture** ([ADR-0026](docs/adr/0026-static-asset-storage.md), #341) — the first asset-bearing theme to move off stellar-ui's static tree and onto api delivery, with its imagery in the asset store. `postmod` remains on the ui side, blocked on the commercial-font licensing question in #343.

- **Nullable `cssUrl` for no-render registry rows** (#371) — a `Stylesheet` row may now carry `cssUrl: null`, meaning it appears in the theme picker and renders nothing. That is Sublime: the bundled Tailwind already is Sublime, so there was never a sheet to deliver. Expressing it as null rather than a fabricated URL makes the delivery contract a total partition — every row is `/css`-backed or null — which is checkable without an exception list, and an exception list is where the next dead entry would hide. A CI guard asserts the partition over the seeded registry.

- **The wiki pages the Golden Rules link to** (#126, #215) — the canon has always cited `${invite_article}`, `${classes_article}`, `${requests_article}` and `${interfaces_article}` as `/wiki/...` routes, and nothing ever created them, so every install shipped a canon with dead links. `seedWikiFixtures` now seeds eleven System-owned pages, authored as real markdown under `prisma/seed-wiki/` so they review as prose in a diff: the two sub-ruleset pages (`forum-rules`, `staff-rules`), the four feature explainers above, and the five policy-guidance pages behind Golden Rules 5 and 6 — `vpns`, `ips`, `autosnatch`, `security-disclosure`, `exploits`. It guards create-if-absent per slug rather than table-wide, so re-running never clobbers an operator's in-app edits while a fixture added in a later release still lands on an existing install. A drift spec asserts every internal `/wiki/...` token has a fixture, which is what stops the dead-link bug recurring silently.

  The five guidance pages were filed as public-KB content on korin.pink and are in-app instead: every behaviour they govern — browsing through a proxy, snatching freepass, probing the live site — requires an account, so the auth gate costs nothing. Only the Interview and IRC pages clear the pre-account bar, and those stay on korin.pink under `STELLAR_PUBLIC_KB_BASE` (corrected from `kb.stellargra.ph`, a domain with nothing behind it, to `https://korin.pink/wiki`).

### Changed

- **The registry delivery partition is enforced on the write path** (#375) — `POST`/`PUT /api/stylesheet` previously accepted any non-empty `cssUrl`, so a strict-admin could still create a row pointing at the retired `/stylesheets/…` tree: it lands in the picker and renders nothing. The schema now validates the delivery-route shape (sharing the predicate with the CI guard rather than restating it), and the module additionally verifies the row resolves to a real `AuthorStylesheet` — a well-formed URL naming a sheet that does not exist is the same dead entry. `null` remains the explicit no-delivery value, and stays distinct from an omitted key meaning "leave unchanged". Published in the OpenAPI contract, so generated clients inherit the constraint.

- **`publish` no longer runs on pull requests** (#380) — the job logged into GHCR, built the image, and discarded it, since `push:` was already gated to non-PR events. Gating the job itself is safe here because `smoke` builds the same Dockerfile on PRs and boots it against a fresh database, so the image is still validated before merge — by the job that also proves it runs.

- **GitHub Releases are created from the CHANGELOG on tag push** — tagging never produced a Release, and the manual habit lapsed after v0.5.6, leaving that version advertised as "Latest" through nine subsequent releases. A tag-triggered job now publishes the tag's CHANGELOG section as its Release notes, gated behind a successful image publish so a Release never announces an artifact that does not exist. The nine missing Releases (v0.6.0 through v0.8.1) were backfilled from the same sections.

- **`AGENTS.md` is the canonical agent-instruction file** — `CLAUDE.md` reduces to an `@import` of it, ending the drift between two files that had been maintained in parallel.

### Fixed

- **The `cssUrl` migration is scoped to Sublime alone** (#371) — the nullable-`cssUrl` data migration originally matched the whole retired `/stylesheets/…` prefix, which would have blanked `postmod` while it is still served from stellar-ui. Narrowed to Sublime's exact dead path.

- **The partition guard asserts every violation, not just the first** — the test reported one offending row per run, so a sweep would have needed as many CI runs as there were bad rows.

- **The tracker frontier query returned an empty frontier when three tickets were ready** — `blocked_by` keeps listing a blocker after it closes, so the original test never matched once a map started resolving, and the snippet fabricated data on failure rather than erroring.

### Docs

- **[ADR-0031](docs/adr/0031-injected-css-threat-model.md) — the injected-CSS threat model, superseding ADR-0003** (#349) — ADR-0003's amendment correctly dropped the cascade-lock arm, but in preserving theming freedom it also reversed the CSP's resource axes, and stellar-ui shipped `img-src`/`font-src`/`connect-src` open. For exfiltration the CSP constrains nothing, leaving the store-time sanitizer standing alone while five places across the two repos claimed it had a partner. The ADR writes the model for the non-consenting viewer rather than the consenting adopter, since PRD-03's page-context-first precedence means a profile sheet executes in every visitor's browser.

- **[ADR-0024](docs/adr/0024-stylesheet-delivery-contract.md) accepted, and its delivery-contract drift reconciled** (#348) — the ADR had been Proposed since 2026-07-02 while the code treated it as settled. Three later amendments record what shipped: that the second delivery mechanism is retired, what the partition guard actually reaches (seeded rows only — migration-planted rows such as `postmod` remain out of reach), and that the UI half landed.

- **[ADR-0032](docs/adr/0032-authored-stylesheet-member-lifecycle.md) — the authored-stylesheet member lifecycle** — what happens to an authored sheet and its adopters when the author leaves or the sheet is withdrawn.

- **The `/css` addressing decision recorded, and a control that never shipped struck** — the route's id-based addressing is documented, and a control the ADR claimed but which was never implemented is removed rather than left as a false claim.

- **[ADR-0026](docs/adr/0026-static-asset-storage.md) annotated where ADR-0031 collapsed its rationale** (#351) — §44 justified the asset validator's validate-and-reject signature by contrasting it with the CSS sanitizer's cleanse-don't-reject posture. ADR-0031 retired that posture, so the two converged and the stated rationale reads backwards. Annotated rather than rewritten: the ADR records why they diverged at the time.

- **Wayfinder tracker operations documented** (#356) — how this repo expresses maps, parentage, blocking, and the frontier. Sub-issue parentage and issue-dependency blocking are both native here, and both APIs take the internal `id` as an integer field.

## [0.8.1] — 2026-07-18

Makes the 0.8.0 stack verifiable in place: a deployed container can now seed its own e2e fixtures, so an end-to-end pass against a live box needs no temporary database exposure.

### Changed

- **The e2e fixture seeder ships in the image** — `seed-e2e-users.ts` moves from `prisma/scripts/` (outside the `rootDir: src` build, so it needed a ts-node toolchain and a reachable database port) into `src/scripts/`, compiling to `dist/scripts/seed-e2e-users.js`. A deployed container stack can now seed its own e2e fixtures with `docker compose exec api node dist/scripts/seed-e2e-users.js` instead of temporarily exposing Postgres to the host. Because the fixtures use known weak credentials and the script now reaches every deployment, it refuses to run when `NODE_ENV=production` unless `ALLOW_E2E_SEED=true` is set explicitly.

## [0.8.0] — 2026-07-18

The alpha-deploy cut. A fresh instance is now safe to stand up in public — registration starts closed and the install checklist walks the admin to launch — and the release drops the korin ledger client the announce runbook proved redundant. CRS gains a channel-weight lever, ratio gains Freepass/Neutralpass, and the CRS design frontier is settled in the spec ahead of implementation.

### Added

- **IRCScore channel-weight mechanism** (#141) — `channelQuality` now reads an `effectiveChannels` count that an optional `KORIN_CHANNEL_WEIGHTS` map (JSON `{"#channel": weight}`) can re-weight per channel, so a firehose everyone idles in can count for less than a niche channel. The map is empty by default and behaviour-identical to the previous raw channel count; actual weight values stay deferred until real multi-channel traffic exists to calibrate them (PRD-02). Ships with the first test coverage for `getIrcScore` and the CRS IRC dimension.
- **Announce push-path verification** (#299) — the previously-untested cursor/retry loop (`runAnnounceCycle`, extracted for testability) and the korin `POST /irc/announce` wire contract (`InboundFeedSchema` shape, plain notify-and-link) are now covered by tests, plus a live end-to-end runbook (`docs/runbooks/announce-e2e.md`).
- **Freepass/Neutralpass ratio-exempt Contribution flags** (PRD-06 #4) — a Contribution can be flagged Freepass (consumption accrues no `consumed` for the consumer; the contributor still earns `contributed`) or Neutralpass (neither side accrues, fully ratio-neutral) [#260].

### Changed

- **Fresh installs default registration to `closed`** — a newly installed instance no longer accepts self-registrations until the admin deliberately opens it: the `SiteSettings.registrationStatus` default flips from `open` to `closed` (app-level `DEFAULTS` and DB `@default`, with a migration; existing rows keep their value), and the install launch-checklist item inverts from the old `registration-open` warning to a `registration-closed` advisory telling the admin to switch to `open` or `invite` when ready to accept registrations [#332].

### Removed

- **The korin `ledger` client is withdrawn** — the consumption-event ingest and grant-time `canConsume` gate merged earlier in this unreleased window (#261) are removed along with `GET /api/ledger/snapshot`. Exercising the announce runbook against a live korin stack showed the gate to be redundant: its verdict rides `canDownload`, the same flag `downloads.ts` already reads authoritatively from Postgres in the same request, while stellar's stricter balance gate had no korin equivalent. No user-facing behaviour changes — the removed gate could only deny what stellar already denied, and it failed open. Stellar's own accounting (`contributed`/`consumed`, `economyTransaction`, the ADR-0006 ratio-relief substrate) is untouched. Reasoning recorded in ADR-0016, now Superseded.

### Docs

- **ADR-0029 — integrity-monitoring / abuse-detection contract** (#300) — the follow-on ADR ADR-0016 deferred: defines the abuse-signal taxonomy, a cursor-pulled `GET /ledger/integrity` wire shape reusing the existing keys, and the stellar action model (evidence into staff review or a bounded CRS drag — never an automated gate). Its transport was withdrawn later in this same window along with the ledger sidecar, so the ADR ends the release marked blocked and stays Proposed: the taxonomy and action model are transport-independent and worth keeping, but any implementation must specify and justify its own substrate first.
- **PRD-01 CRS design questions settled** (#122, #227, #229, #235, #236) — a design pass over the four CRS issues carrying `[design]`/`needs-info` framing found only one real open question. Wiki becomes a Contests sub-signal (cap 2) while Forum stays unscored (post volume is the only available signal and the only ungated input in the model); Contests is shaped to be buildable with independently capped sub-signals summed then clamped at the umbrella cap, and Stylesheet folds in — reversing "not folded yet" and resolving the double-count PRD-01 already acknowledged.
- **ADR-0030 — access-gated announce delivery for private communities** (#177, design-only) — models the access-control feature ADR-0015 deferred: a dedicated `Community.visibility`, membership single-sourced from existing role relations ∩ verified nicks, an optional `target` on the announce push, and the crux decision that stellar projects membership while korin enforces the channel ACL.
- **IRCScore magnitude reconcile** (#141) — corrected the stale `IRC_CAP = 6` in ADR-0013 to the pinned `2` and documented the channel-weight mechanism in ADR-0013 and PRD-02.

## [0.7.0] — 2026-07-11

The 0.6.x consolidation wave closes (#287): a fresh container now boots batteries-included (migrate + seed, ready for /install), dependency and image freshness runs on autopilot, and the commit-to-merge pipeline drops from tens of minutes to minutes at both ends.

### Added

- **Containers seed the idempotent baseline on boot** — the self-migrating entrypoint (#276) left a fresh `docker compose up` with a migrated-but-empty database; the seed sequence is now extracted into `seedAll()` (one source of truth for the dev `prisma/seed.ts` and a new compiled `dist/scripts/seed.js`) and runs after `migrate deploy` on every boot. Every seeder is idempotent, so it is a no-op on an existing DB; seeding deliberately does not stamp `installedAt`, so /install stays available to mint the SysOp. The publish smoke job now asserts ranks were seeded alongside the migration assertion [#313].
- **Renovate manages dependency and image bumps** — pinned tags are kept fresh rather than unpinned to floating; dev-tooling patch/minor, github-actions digests, and lockfile maintenance are pre-approved classes that merge via the app's branch-protection bypass, while Prisma, Docker base images, and all majors remain individually human-reviewed; weekly schedule with grouped non-major bumps to limit PR volume.

### Changed

- **Pre-commit and CI typecheck cost cut at the measured sources** — trace attribution showed the tax was cold whole-graph re-checks plus two Prisma type pathologies, not zod inference: both tsconfigs now persist incremental build info (warm `tsc --noEmit` re-checks only the changed subgraph), `testPrisma` is annotated as canonical `PrismaClient` (one unannotated export cost a 29s structural compare), `version:check` runs ts-node transpile-only (was ~40s of boot-time type-checking), and `jest.integration.cjs` gets the same `isolatedModules` treatment as the unit config so the CI integration step stops re-type-checking every suite's import graph. The full pre-commit chain drops from ~8.5 minutes to ~1 minute warm [#306].
- **Integration tests run as their own parallel CI job** — measurement showed the step is DB-bound (~4.5 min) and the long pole of the required check, so it moves out of the `test` job's critical path (6m48s → 2m37s); branch protection on `main` now requires both `test` and `integration` [#306].

### Docs

- **Human-facing developer docs** — a real getting-started path for humans (not just agents), plus fixes for README errors that broke a fresh install when followed literally.
- **stellar-compose joins the constellation map** — CONTEXT cross-links the deployment repo, closing the publish/deploy boundary loop recorded in ADR-0027.

## [0.6.9] — 2026-07-09

A consolidation cut on the road to 0.7.0: reporters get notified when their reports resolve, two OpenAPI contract-drift bugs are closed at the source, and the last undocumented subsystems and pipeline boundaries get their governing docs.

### Added

- **Reporters are notified when their report is resolved** — on report resolution a null-sender System PM is sent to the reporter with the resolution text, the resolution action, and a link back to the report. It is fire-and-forget: a failure to send never rolls back or blocks the resolve [#273].

### Fixed

- **`Notification.type` now advertises all ten notification kinds** — the OpenAPI contract derives the enum from the Prisma `NotificationType` instead of a hand-maintained list of six, so `site_news`, `global_notice`, `rank_promoted`, and `rank_demoted` are type-narrowable by clients and the enum can no longer drift from the source [#302].
- **Nullable profile references no longer drop their `null`** — `PublicProfile`/`MyProfile` `community`, `donorPresentation`, and `staffPmOverview` generate as `T | null` instead of `T & unknown`, matching what the routes actually return; the codegen shape that swallowed the null is normalized during export [#295].

### Docs

- **ADR-0027 — the publish/deploy boundary** — the stellar-api pipeline's responsibility ends at the versioned GHCR publish; deployment and environment promotion live in stellar-compose, with a pinned semver image tag as the handoff artifact [#293].
- **ADR-0028 and PRD-10 — the user-classes ladder and automated progression** — the shipped class-progression system (rank ladder, promotion rules, sweep job, `rankLocked`) finally has a governing doc, recording the classes-versus-CRS firewall, link-health-eligible byte accounting, the prestige predicate, and the demotion guards [#303].
- **CONTEXT retires the Chrome Layer entry** — the retired stylesheet-injection term is marked do-not-rebuild and the stellar-ui cross-links are resolved [#305].

## [0.6.4] — 2026-07-07

The built-in theme catalog becomes api-canonical and single-sourced, and the api version aligns with stellar-ui.

### Added

- **Eight more built-in themes are api-canonical** — `kuro` and `layer-cake` (previously bundled in stellar-ui) plus six token-only conversions (`shiro`, `mono`, `minimal`, `hydro`, `bubblegum`, `white`) now ship as System-owned `AuthorStylesheet` fixtures delivered via `GET /api/stylesheet/author-stylesheet/:id/css` — single-sourced like `anorex`/`dark-ambient` before them, so the theme catalog has one home (the api registry) rather than a split across two repos [ADR-0024, ADR-0026]. Asset-bearing themes stay out until the asset store lands.

### Changed

- **dark-ambient link/text contrast** — the resting link colour is lifted (`--st-link` → `#2b95e0`) so link text clears WCAG AA on the dark panels, while `--st-accent` keeps its deep muted-blue signature on chrome; body `--st-text` nudged to `#999999` to clear AA on the raised-row surface.

### Fixed

- **Theme contract drift closed** — `--st-lossless` added to the api's required `--st-*` primitive set (20 → 21), matching the stellar-ui token contract; the fixture drift-guard now pins every built-in theme to the full primitive set.

### Docs

- **ADR-0026 accepted** — static-asset storage for theme imagery and content assets moves from Proposed to Accepted; implementation is tracked separately [#290] (it unblocks the asset-bearing themes that the `/css` route can't carry).

## [0.6.3] — 2026-07-07

Stylesheet registry integrity: the built-in themes become api-canonical and single-source, and delivery is guarded so a dead theme-picker entry can't ship.

### Added

- **Built-in stylesheet fixtures are api-canonical** — `anorex` and `dark-ambient` are stored as `AuthorStylesheet` rows owned by a reserved System user and delivered via `GET /api/stylesheet/author-stylesheet/:id/css`; each registry row's `cssUrl` points at that route, so the stored source is the single canonical artifact, no silent static-file duplicate [#285, #286, ADR-0024]. `dark-ambient` — previously a registered row with no stylesheet anywhere (a dead theme-picker entry) — now ships as a token-only theme (stellar-ui ADR-0005) [#286].
- **Reserved System user** — a non-interactive, disabled account (`seedSystemUser`) owning built-in content fixtures; seeded before them in both the dev seed and the install flow.
- **Registry ↔ delivery consistency guard** — an integration test asserts every `/css`-backed registry row resolves to a real, non-empty `AuthorStylesheet`, and a pure spec pins each built-in theme to the full `--st-*` primitive set, so a dead or half-painted theme fails CI instead of shipping [#286].
- **ADR-0026** — static-asset storage plan (design) for theme imagery and content assets the `/css` route can't carry [ADR-0026].

### Fixed

- **Mass PM gated by a granular permission** — mass private messaging now requires `messages_mass_pm` rather than a broad role check [#281].

### Docs

- **ADR-0014** — per-user contribution feed (derive the token, don't mint a secret); cross-linked to the live PRD-02 and ADR-0015.
- **ADR-0025** — moderation & messaging surface model (Reports vs Personal Messages vs Staff Inbox).

## [0.6.2] — 2026-07-03

A 0.6.x increment landing the stylesheet delivery contract (registry CSS serving + a single-source slot), site-wide author-sign propagation, the staff-inbox consolidation, and a self-migrating runtime image.

### Added

- **Registry stylesheet CSS delivery** — `GET /api/stylesheet/author-stylesheet/:id/css` serves an adopted author sheet's stored, sanitized source as `text/css` (no-cache, nosniff), so the UI injector can link it like an external URL [ADR-0024, PR #256]. OpenAPI path registered [PR #257].
- **`anorex` built-in theme** — registered in the `stylesheets` registry so the wood-toned theme shipped by stellar-ui is reachable through the theme picker [#255].
- **Release-scoped contributions read** — `getReleaseWorkbenchView` now embeds the `ReleaseFile` satellite and `Edition`, so rip-quality and edition are readable from a release-scoped GET (was POST/search-only), unblocking the UI edition-disclosure feature [#129].
- **`PUT /api/users/:id/rank-lock`** — staff can freeze/unfreeze a user from auto class-progression; `rankLocked` also exposed on the staff rank-assignment read [#203].
- **Self-migrating container** — the runtime image runs `prisma migrate deploy` on boot (fail-fast) before exec'ing the app, so a merged-but-unapplied migration can no longer serve a schema-behind DB; a CI `smoke` job boots the real image against a fresh Postgres and gates publish [#276].

### Changed

- **Site Stylesheet slot is one explicit source** — Personal (external URL) and Registry (`activeAuthorStylesheetId`) are mutually exclusive; selecting one clears the other, enforced server-side on the profile write. The pointer joins the profile contract; `externalStylesheet` is tightened to `https:`-only [ADR-0024, PR #256].
- **Author-stylesheet list paginated** — `GET /api/stylesheet/author/:userId` returns the standard `{ data, meta }` envelope, plus a rank-gated cap on stored sheets [#146].
- **RankPromotionRule CRUD guarded to adjacent ladder steps** — promotion-rule admin writes are constrained to neighbouring class levels [#170].
- **Staff-inbox ticket engine consolidated** — the duplicated engine (copied into `staffPm.ts`, then drifted) is unified onto `staffInbox.ts`; the duplicate module + schema are deleted [#272].
- ESLint config marked `root: true` so a checkout nested inside another (a git worktree) lints cleanly instead of cascading into the outer repo's config.

### Fixed

- **Author signs follow the author site-wide** — donor sign and warning sign now ship on every PostBox author payload (forum/comment/PM/staff-inbox) via a shared `AuthorRef` seam, not just the profile page [#231].
- **`getRatioStats` 404s on a missing user** — throws `AppError(404)` per the codebase convention instead of a raw `Error` the global handler mapped to a generic 500 [#233].

### Docs

- **ADR-0024** — stylesheet delivery contract (URL vs stored-source registry serving); PRD-03 amended (`.css`-only, storage shape closed, "registry spaces" naming); superseded ADR-0003 Arm-1 comments corrected [PR #256].
- **ADR-0023 (proposed)** — `ReleaseGroup` cross-community identity node + the Contribution package seam.
- **ADR-0025** — moderation & messaging surface model: Reports (content-anchored), Personal Messages (user↔user), and Staff Inbox (generic member→staff) are three separate systems; Staff Inbox is one role-dispatched entry (no separate "Staff Queue"). Reconciles a stellar-ui surface drift ([stellar-ui #164](https://github.com/orphic-inc/stellar-ui/pull/164)); staff-class tiering deferred.

## [0.6.1] — 2026-06-25

A 0.6.x increment consolidating the post-0.6.0 work: a new rip-log scorer, the running-version endpoint, and the latest CRS dimension tuning.

### Added

- **EAC/XLD rip-log scoring module** — `POST /log-check` grades a submitted rip log.
- **`GET /api/version`** — exposes the running platform version, derived from the manifest so it can't drift [PR #243].
- **`db:seed-e2e`** — deterministic users + invite tree for E2E runs.

### Changed

- **Invite-tree Contagion** — graded, distance-decaying suspicion across the invite tree [#155, PR #249].
- **Stylesheet CRS** — tiering escalation curve [#121, PR #248].
- IRCScore cap pinned to 2; PRD + CONTEXT-MAP drift reconciled.
- AuthorStylesheet author/adopt routes registered in the OpenAPI contract.
- ADR-0003 — dropped Arm 1 chrome isolation; themes are visually unrestricted.
- Husky — type-check folded into pre-commit; docs synced to current patterns.

### Fixed

- `docs/erd.md` — high-level map so GitHub renders the ERD.

### Docs

- Corrected the `AuthorStylesheet.source` sanitization note.

## [0.6.0] — 2026-06-23

One release consolidating the post-0.5.6 work, shown as dated milestones — no intermediate versions were tagged, so this is the genuine history rather than a fabricated 0.5.7–0.5.9 ladder. Entries already credited in 0.5.5/0.5.6 (tags cut ahead of merges) are not repeated.

### 2026-06-23

- **PRD-01 CRS dimension roadmap** — the nine live dimensions plus the scoped additions (ContributionScore, Leadership, Contests, Concerts) and the governing decisions [#230].

### 2026-06-22

- **Golden Rules** — a 6-rule canonical tree seeded from `CODE_OF_CONDUCT.md` with read-time `${…}` variable resolution and `GET /api/rules/tree` [#215, PRD-09, ADR-0020].
- **CommunityLeader role** — a scalar `Community.leaderId` (a superset of staff), transfer via `PUT /communities/:id`, seeded for the flagship community at install [#216, #217, #221, ADR-0021].
- **Install state recorded as a fact**, not inferred from row counts [ADR-0022].
- **Trunk-only CI** — workflows off the retired staging/develop branches; widened the format gate to `prisma/**/*.ts` [#224].
- ForumRules/StaffRules documented as built [#126].

### 2026-06-21

- **Lifetime link-health CRS dimension** — `R × (1 − e^(−H/τ))`, PASS-only accrual [#95, ADR-0019].
- **CRS time-series snapshots** — the trend layer [#94, ADR-0007].
- **Per-ReleaseType upload size caps** [#93].
- **Version-consistency guardrail** across the manifest, `/health`, and OpenAPI surfaces [#79].
- Verified IRC nick exposed on the self settings read [#201].
- `CODE_OF_CONDUCT` + `SECURITY` added; OpenAPI/Testing folded into CONTRIBUTING.

### 2026-06-20

- **ADR-0018 development lifecycle + enforced API/UI contract gate** — the OpenAPI freshness gate de-inerted (now tracking `openapi.json`) [#204], plus issue/PR templates and a security-review gate.

### 2026-06-19

- **CRS dimensions — PRD-01's formula filled out.** Invite + Donation complete the v0.0.x set [#61, #62]; a signed, contribution-gated **CommunityScore**, quality-weighted so a lossless/logged/cued rip pulls more than a transcode [#75, #76, ADR-0017].
- **Automated user-class progression** — a background sweep job with promote/demote notifications [#169] and `RankPromotionRule` CRUD + the per-user progression endpoint [#170, #171].
- **Friends lifecycle** — request/accept, mutual-friend detection, and standardized response contracts [#60, PRD-01].
- **Paranoia-gated community-stats profile block** — friends count, invite summary, and reputation view (PRD-01 Profile Integration).
- **PM contributors** when a contribution link is swept WARN→FAIL [#125].
- Fixed: raised the devTools integration hook timeout to stop a flake [#165].

### 2026-06-18

- **Automated user-class progression — foundation** — `RankPromotionRule` + `User.rankLocked` schema [#167] and the ladder + rule seed [#168].
- **ADR-0016** consumption-accounting & ratio-gate contract; Freepass/Neutralpass settled; a cross-repo CONTEXT-MAP + multi-context agent-skills config.
- Fixed: install seed URL port corrected to `:9000` (the UI dev server); regenerated `docs/erd.md` to sync the irc-nick nonce fields.

### 2026-06-17

- **Verified IRC nick link** — challenge/nonce proof-of-control for `User.ircNick`; only a verified link credits IRCScore or resolves the korin nick→account lookup; user-facing route registered [#175, #198, ADR-0015].
- **PRD-02** reconciled to korin.pink [#163].

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

[Unreleased]: https://github.com/orphic-inc/stellar-api/compare/v0.8.1...HEAD
[0.8.1]: https://github.com/orphic-inc/stellar-api/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/orphic-inc/stellar-api/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/orphic-inc/stellar-api/compare/v0.6.9...v0.7.0
[0.6.9]: https://github.com/orphic-inc/stellar-api/compare/v0.6.4...v0.6.9
[0.6.4]: https://github.com/orphic-inc/stellar-api/compare/v0.6.3...v0.6.4
[0.6.3]: https://github.com/orphic-inc/stellar-api/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/orphic-inc/stellar-api/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/orphic-inc/stellar-api/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/orphic-inc/stellar-api/compare/v0.5.6...v0.6.0
[0.5.6]: https://github.com/orphic-inc/stellar-api/compare/v0.5.5...v0.5.6
[0.5.5]: https://github.com/orphic-inc/stellar-api/compare/v0.5.4...v0.5.5
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
