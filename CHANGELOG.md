# Changelog

All notable changes to stellar-api are documented here.

---

## [Unreleased]

### Changed

- **The integration suite no longer issues ~23,000 `TRUNCATE` statements per CI run** — `truncateAll` runs in `beforeEach` for every integration test and looped over `pg_tables` issuing one `TRUNCATE` per table: ~126 tables x ~185 tests, `--runInBand`, so strictly serial. That is an almost purely I/O-bound workload — relation-file truncation and fsync — which is why a contended runner did not slow the suite a little but inflated it **4-16x across every suite at once**, one 68-minute run against a 6-11 minute baseline. The suite that failed was never the cause: `staffLists` was simply the first `beforeEach` to cross the 60s hook ceiling, and [#165](https://github.com/orphic-inc/stellar-api/issues/165) was this same shape in June, "fixed" by raising the timeout from 30s to 60s — which only changed which suite trips first. It is now a single batched `TRUNCATE a, b, c … RESTART IDENTITY CASCADE`: one lock acquisition, one pass. The loop it replaces was already documented as a non-load-bearing leftover from the [#424](https://github.com/orphic-inc/stellar-api/issues/424) deadlock work — it ran inside one `DO $$ … $$` block, so it held every `ACCESS EXCLUSIVE` lock until commit exactly like the batched form, and if anything widened the deadlock window by acquiring locks one at a time. `drainBackgroundTasks` is, and remains, the actual deadlock fix.

- **CI's PostgreSQL keeps its data directory on tmpfs.** The CI database is created and thrown away inside one job, so durability there buys nothing while costing every fsync the truncate-heavy suite generates. `--tmpfs /var/lib/postgresql/data` on both the `test` and `integration` service containers removes the disk-I/O sensitivity that made runner contention so violent — the variance, not just the mean, is the thing this targets.

- **`CHANGELOG.md` merges by union.** Every PR touching shipping code must edit it (the [#386](https://github.com/orphic-inc/stellar-api/issues/386) gate) and entries are appended at the top, so concurrent PRs collide there by construction — always as "both sides added a bullet", never a real disagreement. A new `.gitattributes` marks the file `merge=union`, which keeps both sides instead of raising a conflict. That removes the rebase-an-already-green-PR tax, and closes a sharper hazard: a hand-resolved conflict can silently drop the _other_ PR's entry, which the #386 gate cannot detect — it checks that a PR touches the file, not that it preserved someone else's bullet — and the `release` job would then publish the incomplete section as Release notes, permanently. Union merge can interleave two bullets in an unintended order, which is worth a glance at review; it cannot lose one.

### Added

- **Private-community announces now carry a routing target** — the first stellar-side slice of [#328](https://github.com/orphic-inc/stellar-api/issues/328) ([ADR-0030](docs/adr/0030-private-community-announce-delivery.md) Decision 3). `POST /irc/announce` gains an optional `target: { visibility, community }` derived from the contribution's community `announceVisibility`, so korin can route a private community's line to its gated `#c-<id>` channel instead of the `#announce` firehose. The identifier is the **numeric `Community.id`**, never a name or slug, so the channel survives a community rename; `channel?` stays in the wire contract as a forward-compat slot and is deliberately not sent, because korin derives it and stellar has no field to fill it from. **The extension is backward-compatible by omission:** a public community, or a contribution with no community at all, sends no `target` key — not `target: null` — so its push body is byte-identical to the pre-ADR-0030 one, and korin's existing handling is untouched. Note the wire field stays `visibility` while the stellar column is `announceVisibility`: only the column was renamed, and it is named for what it gates because **this flag is routing only and must never enter an access check** ([ADR-0015](docs/adr/0015-verified-irc-nick-link.md), Golden Rule 3) — a `PRIVATE` community with open registration stays readable by anyone, and the gated channel controls who _sees the line_, never who may download.

- **Private communities project their member set to korin as an IRC channel ACL** — the reconcile half of [#328](https://github.com/orphic-inc/stellar-api/issues/328) ([ADR-0030](docs/adr/0030-private-community-announce-delivery.md) Decision 4). A new `membershipJob` walks every `PRIVATE` community on the `KORIN_POLL_INTERVAL_MS` cadence and pushes its complete eligible **verified**-nick set to korin's `POST /irc/membership`, keyed by the numeric `Community.id` so the derived `#c-<id>` channel survives a rename. korin overwrites its ACL from each projection — a **disposable materialized view, replaced and never diffed**, so it self-heals across a korin restart with no reseed protocol. **Full sets rather than deltas, deliberately:** membership here is _derived_ from roughly eight scattered mutation points (member/curator/contributor add and remove, leader change, nick verify and unverify, disable/ban, a visibility flip) with no single choke-point to instrument, so a full replace has nothing to miss where per-seam deltas would have eight places to forget. An **empty set is projected verbatim** rather than skipped — "nobody may see this" is a legitimate state, and skipping would leave korin holding an ACL stellar believes it has replaced. Eligibility composes the existing `communityRoleUnion` (consumer ∪ contributor ∪ curator) rather than restating its arms, and adds two filters: only `ircNick` — which by construction holds a _verified_ nick, never an unproven `pendingIrcNick` claim ([ADR-0015](docs/adr/0015-verified-irc-nick-link.md)) — and not disabled accounts. Site staff are **not** included: `communities_manage` is an Axis-2 global capability, not membership in every private community. The job is dedicated rather than folded into `announceJob`, and unlike that job it **holds no cursor** — a full-set projection is idempotent and order-free, so one community's failure never stalls the rest and everything simply retries next tick. Staleness is costless by construction: this gates announcement _visibility only, never a download_ (Golden Rule 3), so a late tick means a removed member may see that a release _exists_ for at most one interval.

- **A private community's channel ACL is freshened immediately before its announce goes out** — the piggyback that completes [#328](https://github.com/orphic-inc/stellar-api/issues/328)'s stellar side ([ADR-0030](docs/adr/0030-private-community-announce-delivery.md) Decision 4). Without it, the first line after a membership change would route into a channel whose ACL is up to one `KORIN_POLL_INTERVAL_MS` tick stale — the new member misses exactly the announce that prompted them to join. `runAnnounceCycle` now projects a private community's membership just before routing its line. **It is strictly best-effort and never gates the announce:** projection and delivery are independent failure domains sharing one ordered cursor, so holding that cursor for a membership failure would let a single `/irc/membership` outage wedge the entire ordered firehose — public communities included — to protect a property that is costless to lose, since a stale ACL delays _visibility only, never a download_ (Golden Rule 3). A failed projection is logged and the line goes out regardless; the periodic reconcile self-heals the ACL on the next tick. The guard is a catch-all rather than a check of the return value alone: the projection returns `false` for a failed push, but its DB reads can still throw, and an exception escaping would abort the cycle — gating the announce by the back door. Which items count as private is decided by the same `announceTarget` that builds the routing target, so the piggyback and the routing cannot disagree.

### Fixed

- **`npm run changelog:check` no longer hangs forever, and no longer answers a question nobody asked** — the local half of the [#386](https://github.com/orphic-inc/stellar-api/issues/386) gate read `readFileSync(0)` unconditionally and treated an empty result as "nothing was piped in". That cannot work: the call blocks until the writer closes the pipe, and "nothing is on stdin" is indistinguishable from "the writer has not written yet" until it does. Any caller that inherits an open stdin it never writes to and never closes — an editor task runner, a CI shell, an agent harness — blocked indefinitely; one invocation was found still parked after **fifteen hours**, at 0% CPU, holding a process slot. Its own docstring claimed the read returned `''` "when stdin is a TTY", which was never true and never implemented: reading a TTY blocks on keyboard input until Ctrl-D, and nothing in the file checked `isTTY`. The caller now **states** which input path it wants instead of the script inferring it from the state of fd 0: `CHANGELOG_STDIN=1` reads the pipe (CI sets it), and its absence diffs the working tree without touching fd 0 at all. Requesting stdin mode from a terminal now exits with an explanation rather than looking like a hang.

  **Deciding to read fd 0 and successfully reading it turned out to be two separate problems, and this fix went red twice before clearing both.** The first attempt made the switch an argv flag: `npm run x --silent -- --stdin` forwards the flag under npm 10 and _drops_ it under npm 11, and CI runs Node 24 (npm 11) while a dev box may still be on Node 22 (npm 10) — so it passed every local check and failed on CI. It is now an env var, set by the shell before npm and parsed by no one, and so cannot diverge that way; `--stdin` is still honoured where npm forwards it. The second was subtler and **not** version-dependent: the TTY guard read `process.stdin.isTTY`, and that getter _constructs_ the stream and puts fd 0 into non-blocking mode, after which `readFileSync(0)` throws `EAGAIN` whenever the pipe has no data buffered yet. Whether it broke was purely a race against the writer — a local `printf` fills the pipe instantly and wins; CI's `gh api --paginate` goes to the network first and loses. The guard is now `tty.isatty(0)`, a bare syscall that answers the same question without creating a stream. **The failure path mattered as much as the bug:** the `EAGAIN` was swallowed to `''` and an empty result fell back to git, so on CI the gate died on an unresolvable `origin/main...HEAD` (the runner's checkout is shallow) while _the same fallback run locally simply passed_, silently grading the working tree instead of the piped list. Stdin mode now reads the pipe or exits non-zero, and never re-routes itself to a different input. Covered by `src/scripts/check-changelog.spec.ts`, whose deliberately **slow** writer is the whole point — a fast one passes with the bug present, which is how it shipped twice.

### Added

- **Avatars can be self-hosted in the asset store, and both avatar write paths are now scheme-constrained** — `avatar` was `z.string().url()` on `PUT /api/profile/me` and, until this change, a bare `z.string()` with no URL check at all on `PUT /api/users/settings`. [#361](https://github.com/orphic-inc/stellar-api/issues/361) named only the first: an avatar renders to every viewer of a member's profile and posts, so an arbitrary remote URL collects IP, user agent and visit timing for every member who views that content — no CSS, no adoption, no consent. A boundary on one of two doors is not a boundary, and the second door was the wider one. `AssetKind` gains `Avatar` and `POST /api/asset` gains the `?kind=` param its own comment had reserved for "the day a second kind is uploadable", so a member can store an avatar as `/api/asset/<sha256>` under the existing rank quota, magic-byte validation and image-only rule — the param labels the bytes and gates nothing. Both write paths, plus the donor `customIcon`/`secondAvatar` perks that render on the same surfaces from the same bare `.url()`, now accept only https or a content address. **This narrows [#361](https://github.com/orphic-inc/stellar-api/issues/361) rather than closing it, and the PR says so:** an https remote avatar still discloses IP and timing, because closing that needs the CSP's `img-src`, which [ADR-0031](docs/adr/0031-injected-css-threat-model.md) §6 deliberately keeps open. That deferral is re-filed on a corrected footing — ADR-0031 costed `img-src 'self'` as "breaks every remote avatar", but BBCode `[img]` (`lib/bbcode/render.ts`) renders an arbitrary remote image into every forum post, so the cut was always larger than the avatar-shaped framing implied ([#457](https://github.com/orphic-inc/stellar-api/issues/457)). The sweep is the sharp edge here: `collectReferencedHashes` reads `User.avatar` **and** `Profile.avatar` (two columns, written by different routes, reconciled by nothing), because an avatar the sweep cannot see is collected 24 hours after upload and the profile 404s. `prisma/scripts/backfill-clear-insecure-avatars.ts` clears already-stored `http:`/`ftp:` values by hand, following `backfill-remove-gravatar-avatars.ts` — deliberately not a migration, because nulling an avatar is a visible change to someone else's account. ([#396](https://github.com/orphic-inc/stellar-api/issues/396), [#361](https://github.com/orphic-inc/stellar-api/issues/361))

- **Authors can edit and withdraw their stylesheets** — the authored-stylesheet surface had no update or delete route, while two shipped comments already claimed otherwise (`routes/api/stylesheet.ts` justified `Cache-Control: no-cache` with "Sheets are mutable (authors edit in place)", and `getAuthorStylesheetById`'s docstring called itself "the edit-path read"), and [#350](https://github.com/orphic-inc/stellar-api/issues/350) had decided that adoption tracks the author's edits — all statements about a path that did not exist. The quota compounded it: [#146](https://github.com/orphic-inc/stellar-api/issues/146) enforces registry spaces with no way to free one, a one-way ratchet. `PUT /api/stylesheet/author-stylesheet/:id` edits in place, author-scoped, through the same `assertSafeSource` call site as create — which was written anticipating exactly this ("shared by create and any future edit path"), so an edit cannot smuggle past the ADR-0031 boundary a create is held to. `DELETE` withdraws softly via a new nullable `deletedAt`. **The read-path asymmetry is the whole design:** the list and its total, the quota count, the edit-path read and adoption all filter withdrawn sheets, while `getAuthorStylesheetCss` alone does not — an author freeing a space must not change the site under someone who adopted their sheet. Hard delete was rejected because an adopter's active slot points at the row; refuse-while-adopted because it makes withdrawal a permission other members hold over you. The `CRS_STYLESHEET_ADOPTION` ledger is deliberately untouched: those adoptions were earned, and PRD-03's marginal tier table already eases an author's score down as live counts fall rather than re-rating history. ([#368](https://github.com/orphic-inc/stellar-api/issues/368), [ADR-0032](docs/adr/0032-authored-stylesheet-member-lifecycle.md) §2/§3)

- **CI now requires a changelog entry from any PR that touches shipping code** — `npm run version:check` compares the top **dated** `## [X.Y.Z]` heading against the manifest and never inspects `[Unreleased]`, so work landing between cuts accumulated there unrecorded with nothing to report it: `[Unreleased]` documented 1 of the 21 commits since v0.8.1 until [#384](https://github.com/orphic-inc/stellar-api/pull/384) backfilled it by hand. That was cosmetic until the `release` job began publishing the tag's section verbatim as the GitHub Release notes — an unreconciled changelog is now thin public notes, permanently, on the surface people see first. A new `Changelog entry` step in the existing (already-required) `test` job fails a pull request that changes `src/`, `prisma/` or `.github/workflows/` without also updating `CHANGELOG.md`; `no-changelog` on the PR is the escape hatch, and the `pull_request` trigger gained `labeled`/`unlabeled` so applying it re-evaluates without a manual re-run. The rule is a per-PR file check rather than the commit-range reconciliation the issue first proposed, because two measurements against real history rule that out: entries are not 1:1 with commits (17 bullets for 13 commits at the time of writing — one commit produced two bullets, one bullet covered four commits), so no count-based threshold is sound; and entries get written in batches days later (the SSRF and nodemailer bullets both arrived via an unrelated `docs(adr-0034)` commit), which is the very lag the gate exists to close. Logic lives in a pure `lib/changelogGate.ts` with a `src/scripts/check-changelog.ts` wrapper, mirroring the `versionConsistency` split from [#79](https://github.com/orphic-inc/stellar-api/issues/79); `npm run changelog:check` runs the same rule locally over committed, working-tree and untracked files. ([#386](https://github.com/orphic-inc/stellar-api/issues/386))

### Security

- **The link checker no longer follows user-supplied URLs into private address space** — `linkHealth.checkUrl` probes `Contribution.downloadUrl`, which is whatever a member typed into the submission form, and it passed that string straight to `fetch` with `redirect: 'follow'`. `z.string().url()` only proves the string parses, and the approved-domains gate in the contribution routes is conditional (`if (settings.approvedDomains.length > 0)`), so a default install applied no host restriction at all — making the probe a server-side request forgery primitive against `169.254.169.254`, `127.0.0.1:5432`, and anything else reachable from the API host. The probe is blind, but a PASS/WARN/FAIL still distinguishes an open port from a closed one, which is a working internal port scanner. A new `lib/ssrfGuard.ts` now decides at the egress point: `http`/`https` only, and the host — literal address or every address a name resolves to — must sit outside loopback, RFC1918, carrier-grade NAT, link-local (which carries the cloud metadata endpoints), multicast and reserved space. Redirects are resolved by hand and re-checked at **every** hop, because an allowlisted host is otherwise free to answer with a 302 to a link-local address that the server then dials under its own network identity. A refused URL records `FAIL` without opening a socket. Found by Codacy's Semgrep; see the [ADR-0034 amendment](docs/adr/0034-eslint-9-flat-config-and-the-import-plugin-ceiling.md#amendment-2026-08-30-the-open-question-answered).

- **`nodemailer` 8 → 9** — closes GHSA-p6gq-j5cr-w38f (High), where a message-level `raw` option bypasses `disableFileAccess`/`disableUrlAccess` and enables arbitrary file read and full-response SSRF in the delivered message. This repo never passes `raw` — `sendInviteEmail`/`sendRecoveryEmail` send `from`/`to`/`subject`/`text` only — so exposure was nil, but the dependency is a direct production one and the fixed line is the one to be on. `@types/nodemailer` stays at `^8.0.0`; DefinitelyTyped has published no 9.x, and the surface this repo uses (`createTransport`, `sendMail`) is unchanged across the major.

- **The unused direct `jsdom` dependency is removed, taking eleven `undici` CVEs with it** — `jsdom@^29.0.2` sat in `dependencies` but nothing imported it: every mention of jsdom in `src` is a _comment_ about `isomorphic-dompurify` pulling it in transitively, and Jest runs `testEnvironment: 'node'`. It was, however, the only thing resolving `undici@7.25.0` — eleven CVEs including request smuggling, cache poisoning, cookie-attribute injection and unbounded WebSocket memory growth. `isomorphic-dompurify` carries its own nested `jsdom@30.0.1` → `undici@8.10.0`, which is unaffected, so the install was also carrying two jsdom trees. Removing the direct dependency (and the equally unreferenced `@types/jsdom`) drops `undici@7` from the tree entirely. The sanitizer — the XSS boundary — was smoke-tested directly afterwards and still strips `onerror` and `<script>`.

- **`deepmerge-ts` pinned to ^8 via `overrides`** — CVE-2026-40345 (High, stack exhaustion on recursive object graphs) reaches the production tree through `prisma` → `@prisma/config`, and `prisma` is deliberately a runtime dependency here rather than a devDependency so the container entrypoint can run `prisma migrate deploy`. No prisma release fixes it: even `@prisma/config@7.10.0` still pins `deepmerge-ts@7.1.5`, so an override is the only lever. Real exposure was nil — `@prisma/config` reaches `deepmerge` only in `loadConfigTsOrJs`, which merges a `prisma.config.*` file, and this repo has none — but the finding is legitimate and will recur as soon as one is added (Prisma 7 deprecates the `package.json#prisma` block in favour of exactly that file). v8 keeps the `deepmerge` named export and its merge semantics unchanged, which is what `@prisma/config` hands to c12 as `merger`; `prisma validate` and `prisma generate` both verified under the override. `npm audit` now reports zero vulnerabilities.

- **The remaining dev-only advisories are cleared — `npm audit` is now zero across the whole tree** — thirteen advisories sat in the development dependencies (`@babel/core` arbitrary file read via `sourceMappingURL`, five `brace-expansion` ReDoS/DoS entries, `braces` resource exhaustion, `diff` DoS in `parsePatch`/`applyPatch`, and `extract-zip` unvalidated symlink path traversal reaching in through `puppeteer`). None was ever reported by Codacy, whose Trivy scan covers the production tree — which was already clean — so this closes a gap the dashboard could not see. Applied with a plain `npm audit fix`: `package.json` is untouched, so no declared range moved, and **no production package changed version**. Four majors move, all confined to the ERD toolchain (`puppeteer` 24 → 25, `@puppeteer/browsers` 2 → 3, plus `puppeteer-core` and `chromium-bidi`), which reaches the repo only through `prisma-erd-generator` → `@mermaid-js/mermaid-cli`; `npm run db:erd` was run against the new tree and regenerates `docs/erd.md` byte-identically. The rest is patch-level `@babel/*`, `mermaid`, and browser-target data. Deliberately kept as its own change rather than folded into the security work above, because [ADR-0034](docs/adr/0034-eslint-9-flat-config-and-the-import-plugin-ceiling.md) records [#357](https://github.com/orphic-inc/stellar-api/pull/357) — a lockfile refresh that silently carried prettier and TypeScript across minors and broke `prettier --check` and `tsc`. `typescript`, `prettier`, `eslint` and `jest` are all confirmed unmoved here.

### Changed

- **`LEECH_DISABLED` is now `DOWNLOAD_DISABLED`** — legacy-tracker terminology that outlived the move to Stellar's own vocabulary, on two wire surfaces: the `RatioPolicyStatus` enum value and `RatioPolicyState.leechDisabledAt`, now `downloadDisabledAt`. **This is a breaking contract change** and lands with a paired stellar-ui PR. `download` rather than `consumption` because the status _is_ the `canDownload` flag — `ratioPolicy.ts` sets `canDownload: newStatus !== DOWNLOAD_DISABLED` and `downloads.ts` gates on it — so it belongs beside `DownloadAccessGrant` and `/api/downloads` on the retrieval axis, not beside `consumed`/`Consumer` on the accounting-and-membership one. Choosing `consumption*` would have left `canDownload` mismatched and required a far larger follow-up rename; the UI had already been translating the term for users, labelling it "downloads blocked". The migration is hand-written for the same reason [#422](https://github.com/orphic-inc/stellar-api/issues/422)'s was: Prisma renders an enum value change as a drop-and-recreate of the type, which cannot work while a column depends on it — `ALTER TYPE ... RENAME VALUE` plus `ALTER TABLE ... RENAME COLUMN` move no data. Verified against a _populated_ database rather than an empty one: a row seeded at the old shape came through with its status renamed in place and its timestamp byte-identical. The original `CREATE TYPE` migration is deliberately untouched — migrations are immutable history, and editing one breaks `prisma migrate deploy` on every database that already applied it. ([#345](https://github.com/orphic-inc/stellar-api/issues/345))

- **The release tag helpers live in one module** — `buildPlainTags`, `buildReleaseTagPayload` and `attachTagWithVotes` were defined privately in four modules between them: `releaseBrowse`, `releaseLifecycle`, `releaseWorkbench/load` and `releaseWorkbench/tags`. Every copy was textually identical (`attachTagWithVotes` differed only in whether its `tx` was typed `Prisma.TransactionClient` or the narrower `Pick<typeof prisma, …>`, and the narrow form accepts both, so it won). They now live in `modules/releaseTags.ts`, beside the other `release*` files rather than inside `releaseWorkbench/` — `releaseBrowse` is not a workbench surface and should not import from one, and `releaseLifecycle` already reaches into `releaseWorkbench/snapshot`, so that direction was the established one. The risk this removes is specific: the ±1 vote seeding in `buildReleaseTagPayload` is a scoring convention, and four copies of a convention is four chances to change only some of them.

- **Two collage guards are named instead of retyped** — `src/routes/api/collages.ts` spelled out the same staff-permission triple (`collages_moderate` / `staff` / `admin`) at six call sites and the same load-or-404 at seven. Both are now single helpers. The authorization itself is deliberately **not** consolidated: the routes that share that load each gate differently afterwards — plain "Permission denied", a locked-collage check, a personal-collage owner check, a reorder-specific message — and folding those together would either change a message a client sees or quietly widen a gate, so every 403 stays exactly where it was. `loadActiveCollage` throws `AppError(404)` rather than writing the response, which the global handler renders as the identical `{ msg: 'Collage not found' }` at 404. The GET detail route is not a caller: it deliberately lets staff read a soft-deleted collage.

- **The contribution write `select` is named once** — the create path and the workbench-attach path each spelled out the same eighteen-field Prisma `select` inline. They feed the same response contract, so a field added to one and not the other is a contract that changes depending on which route produced the row. Now a single `contributionSelect`, in the spirit of the existing `releaseCreditsSelect` and `authorRefSelect`.

Together these cut jscpd `src`-to-`src` duplication from **398 to 212 lines (−47%)**, 40 → 33 clones, with no behaviour change.

- **The forum read gate is one function** — `assertForumReadAccess` in the new `modules/forumAccess.ts`, mirroring `communityAccess.ts`. Four routes across `forumPost.ts` and `forumTopic.ts` carried the same select, the same `Forum not found`, and the same `Insufficient class to read this forum` verbatim. Forum class enforcement is something this codebase has already had to audit into place, so one spelling of the read gate is worth more than the lines it saves: a fifth route inherits the check instead of re-deriving it. It lives in its own module rather than in `forum.ts` deliberately — the forum specs mock `modules/forum` wholesale to isolate route logic, so a gate placed there would have to be stubbed by every one of them, which is a good way to disable an authorization check by accident. Kept separate, those specs now exercise the real gate. Only the _read_ floor moved; `minClassCreate` and the moderator-gated paths differ per route and are untouched.

- **Forum post serialization has one home** — `modules/forumPostView.ts` holds `publicPostInclude`, its derived row type, and `serializeForumPost`. The posts routes and the composed topic read in `topicSession.ts` each carried a copy; `topicSession` even labelled its half `// mirrors forumPost.ts`, so the duplication was known — what was missing was somewhere for it to live. Shaped like `authorRef`'s select-plus-mapper pair, because the failure mode is the same: two surfaces selecting the right columns but shaping them differently return a payload the UI renders with one component and two behaviours.

- **The staff-inbox list read is written once** — `listMyTickets` and `listQueue` differed only in their `where`; the ordering, pagination and the latest-message-only include that shapes the list response were spelled out twice.

- **The community membership gate is one helper** — the four routes that add or remove a member or curator carried an identical load, 404, permission pair and 403. Unlike the collage guards above, every copy here really was identical, so there was nothing per-route to preserve by leaving them in place.

Across both passes, jscpd `src`-to-`src` duplication falls from **398 lines to 64 — down 84%** (40 → 26 clones).

- **Codacy's ESLint tool is switched off; Trivy and Semgrep stay** ([ADR-0034 amendment](docs/adr/0034-eslint-9-flat-config-and-the-import-plugin-ceiling.md#amendment-2026-08-30-the-open-question-answered)) — this answers the question ADR-0034 deliberately left open. Deleting `.eslintrc.cjs` in the flat-config migration took Codacy's ESLint configuration with it: Codacy runs ESLint **8**, which cannot read `eslint.config.mjs`, and it silently fell back to its own defaults rather than failing. The repo accumulated 5,040 issues, 92% of which were five type-aware `no-unsafe-*` rules firing because Codacy's sandbox never runs `prisma generate` — so `@prisma/client` is unresolvable and every `prisma.*` access degrades to an `error` type. Those findings are phantoms and are not being triaged; they go away with the tool. What Codacy uniquely caught, and keeps catching, is dependency CVEs (Trivy) and the SSRF above (Semgrep) — neither reachable by a linter. The switch itself is a Codacy **Code patterns** console action: the configuration file can scope a tool but cannot enable or disable one, so it has no repo-side representation.

### Fixed

- **The stylesheet registry can no longer be left with no default** — `getDefaultStylesheetName` ended `?? 'sublime'`, and [#376](https://github.com/orphic-inc/stellar-api/issues/376) had assessed that literal as harmless cleanup on the grounds that the cross-repo half of the drift was already gone (stellar-ui #196 stopped reading the stylesheet _name_). What had not been checked was whether the fallback was reachable. It was: `stylesheets_one_default` is a partial unique index enforcing _at most_ one default, and nothing enforced _at least_ one — `updateStylesheet` only special-cased `isDefault: true`, so `PUT /api/stylesheet/:id` with `isDefault: false` on the current default fell through to a plain update and left the registry with none. `deleteStylesheet` refuses only while a sheet **is** default, so the now-undefaulted `sublime` became deletable, after which every newly created user was handed a `siteAppearance` naming a stylesheet that did not exist. The write path now refuses to unset the last default (`set another as default instead` — mirroring the delete guard; promotion is how the default moves), which makes the fallback unreachable, so it is replaced by a thrown error rather than a literal: if it ever fires the invariant is broken and the registry is what needs fixing, not the default. **No client is affected** — stellar-ui's `StylesheetManager` only ever sends `isDefault: true` and hides the control on the row that already is default, so the API was permitting something no consumer does. The `user_settings.siteAppearance` column default is deliberately left alone: it is a different axis, reached only by inserts that omit the column, and all three creation paths pass an explicit value. ([#376](https://github.com/orphic-inc/stellar-api/issues/376))

- **`/install` no longer bootstraps a site with dangling theme imagery** — `POST /api/install` did not call `seedAll()`; it re-implemented the seed sequence inline, and the two copies had already drifted. The route's copy omitted `seedAssetFixtures`, so a site brought up through the web installer — rather than `db:seed` or the container boot path — got the built-in stylesheet fixtures without the binary assets they reference, leaving the asset-bearing `proton` theme ([#341](https://github.com/orphic-inc/stellar-api/issues/341)) serving permanently dangling `/api/asset/<sha256>` targets. `seedAll` documents why its ordering matters (theme imagery before the stylesheets referencing it; the System user before the fixtures it owns), but a second hand-maintained list cannot inherit a constraint it does not state, which is the actual defect — the omission was the symptom. The route now delegates to `seedAll(prisma)`, which is safe here precisely because it creates no real users and does not stamp `SiteSettings.installedAt`, the two properties that keep `/install` available and required. `seedDefaultCommunity` stays in the route: it needs the SysOp the route mints. A new test pins the install-path half of the claim end to end — every `/api/asset/<hash>` the shipped fixture CSS points at is a hash a fresh install stored. ([#390](https://github.com/orphic-inc/stellar-api/issues/390))

- **A new ruleset seeder can no longer suppress the Golden Rules** — `seedGoldenRules` guarded on a table-wide `client.rule.count()`, making it a no-op once **any** `Rule` row existed rather than once the _golden_ rows existed. It is currently the only rule seeder, so nothing hit it; PRD-05 descent target #3 specs two more (`irc.conduct`, `interview.conduct`), and either one seeding first on a fresh database would have silently suppressed the entire canon — the site would come up with those rules and no Golden Rules, and nothing would report it. The existing drift-guard cannot catch this class of bug: it compares `CODE_OF_CONDUCT.md` to the in-code table and never reads the database, so both would agree perfectly while the `rules` table sat empty of `golden.*` rows. The guard is now namespaced to `code startsWith 'golden.'`, which makes it mean what its name implies and stays correct however seeders are ordered later; each future ruleset guards its own codes. A companion test pins the invariant the guard now depends on — every rule code sits under that namespace — since a code outside it would be invisible to its own guard and collide on re-seed. ([#388](https://github.com/orphic-inc/stellar-api/issues/388))

- **A donor's extra registry spaces and collage slots are now actually granted** — `toAuthUser` advertised `personalCollageLimit` and `authorStylesheetLimit` as the maximum across a member's primary **and** secondary ranks, while both enforcement sites consulted the primary rank alone. Since PRD-03's "$tylesheets — donor-added slots" models the perk _as_ a secondary rank, the promised feature read as granted and enforced as absent: a donor was shown `5`, allowed `3`, and refused with `Author stylesheet limit reached (3)` — a number they had never been told. The same `Math.max` also inverted the `0 = unlimited` semantic these two columns carry (the one `UserRank.assetLimit` documents itself as the deliberate opposite of), so an unlimited primary rank plus a donor secondary of `5` advertised `5` — a perk that _lowered_ a ceiling. Both halves now resolve through one `resolveRankQuota` in `lib/userRankAccess.ts`, the module that already merges primary and secondary ranks: `0` anywhere in the set means unlimited, otherwise the highest cap applies, so a secondary rank can only ever raise a ceiling. `personalCollageLimit` was fixed in the same change rather than left as a known-identical bug on the adjacent line — it is the precedent `createAuthorStylesheet` was written to mirror, and leaving it would have made that comment a lie. **The wire contract is unchanged**: unlimited still serializes as `0`, as it always has; what changed is which number gets sent. `createAuthorStylesheet` also drops its `userRankId` parameter, which named the primary rank — the exact thing that stopped being consulted — and its docstring, which recorded the now-reversed decision as deliberate. ([#369](https://github.com/orphic-inc/stellar-api/issues/369), [ADR-0032](docs/adr/0032-authored-stylesheet-member-lifecycle.md) §4)

- **The E2E fixture seeder now plants a release, so `release.spec` can actually pass** — `src/scripts/seed-e2e-users.ts` created the accounts and the invite subtree but no content, and stellar-ui's `e2e/release.spec.ts` needs one community holding one release. Its own assertion said so — _"No releases found — seed at least one release in the test community"_ — and the failure was structural rather than flaky: P-06 failed on the missing release, and P-07a/P-07b cascaded because both derive their target URL from the release P-06 discovers. The 0.8.1 live-box pass against a real container stack was 14 passed / 14 failed, and three of those failures were this, with no app defect involved. A new `modules/e2eFixtures.ts` seeds one artist, one release in the default community (with the `Main` credit the browse table's artist column is derived from, and the edition `Contribution.editionId` requires), and one contribution owned by the existing `e2e_alpha` fixture. The contribution is not optional garnish: P-07b reports a dead link on an existing contribution and calls `test.skip()` when there is none, so a release-only fixture would have left it permanently skipped — the quiet version of the red-by-default problem this fixes. It lives in `modules/` and takes a `PrismaClient` like every other seeder here (`seedRanks`, `seedGoldenRules`, `seedAll`), which is what lets an integration test drive it against a real database; the production refusal (`NODE_ENV=production` without `ALLOW_E2E_SEED`) stays on the CLI entry point, and the module is inert on import. ([#339](https://github.com/orphic-inc/stellar-api/issues/339))

- **Report deep links no longer depend on a UI redirect shim** — `modules/reports.ts` minted every report `sourceUrl` with the `/private/` prefix that the 0.8.x flattening removed from stellar-ui's route model, across fourteen sites covering users, releases, forum topics, collages, artists, requests and communities. Nothing was visibly broken, because stellar-ui's `LegacyPrivateRedirect` catches them — but every link paid an extra client-side hop, and all of them break the moment that shim is retired. The prefix is gone, and the route shapes are now named once each rather than spelled out inline: the release path alone appeared four times, and artists, collages and forum topics twice each, which is how the prefix survived the flattening in the first place. Parity is exact rather than assumed — the shim is a literal `pathname.replace(/^\/private(?=\/|$)/, '')`, so the post-fix URL is the one users already reach through it, and `lib/bbcode/render.ts` has been building four of these same routes prefix-free all along. **The line that could not wait for a shim** is the resolution PM: `View your report: /private/reports/<id>` is plain text baked into a delivered message, so no redirect rescues it and already-sent PMs keep the stale path permanently. The nine spec assertions that encoded the old strings move in the same change — they are the guard that made this impossible to drop silently, and all nine failed against the fix before being updated. ([#338](https://github.com/orphic-inc/stellar-api/issues/338))

### Docs

- **[ADR-0027](docs/adr/0027-publish-vs-deploy-boundary.md) — the CI chain it describes has gained two jobs** ([#387](https://github.com/orphic-inc/stellar-api/issues/387)) — its Context described the pipeline as `test` → `smoke` → `publish` with `test` being "the full lint/type/unit/integration gate". Accurate on 2026-07-09; not since. `integration` was split out of `test` in [#306](https://github.com/orphic-inc/stellar-api/issues/306) so the DB-bound suite runs in parallel (which also means `test` no longer contains the integration half the Context credits it with), and `release` was added by [#383](https://github.com/orphic-inc/stellar-api/issues/383) to create the GitHub Release from the tag's CHANGELOG section. The Context is left as written — an ADR records what was true when the decision was made — with an amendment carrying the current job graph, the two dependency details the arrow diagram flattens (`smoke` needs only `test`; `publish` needs all three, which is where the full gate is actually enforced), and a Status-line pointer so a reader who stops at the Context is sent to it. **The decision is unaffected:** `release` publishes a record of an artifact, not a deployment — it touches no environment and promotes nothing, so the publish/deploy boundary stands exactly where ADR-0027 put it.

- **[ADR-0030](docs/adr/0030-private-community-announce-delivery.md) §5 described a permission model the code never had** ([#328](https://github.com/orphic-inc/stellar-api/issues/328)) — it said configuring a community's `announceVisibility` rides "the community `leaderId`/`staff` for their own community" alongside site-staff. `PUT /api/communities/:id` has always required `communities_manage` **alone**, so a community leader cannot toggle their own community. The claim came from generalising the membership routes, which genuinely do carry a curator arm (`assertCommunityAdminOrCurator` resolves `communities_manage || admin || curator`, and the leader passes it because create/update connect `leaderId` into `curators`) — the update route does not, deliberately: roster management is day-to-day community work and configuration is a site-level disclosure boundary. **The code is correct and the ADR moves to match**, resolving Consequence 7 as _confirmed, no new permission key_. No behaviour change; §5's body is left as written with a correction pointer, per the ADR-0027 precedent. The divergence had been carried as an open decision on #328 for the length of the epic.

## [0.8.3] — 2026-08-30

### Added

- **`Community.announceVisibility` — per-community control over announce fan-out** ([ADR-0030](docs/adr/0030-private-community-announce-delivery.md)) — slice 2 of the private-community announce work. A community now declares whether its new contributions are published to the IRC announce feed, rather than that being an all-or-nothing property of the site. The default preserves existing behaviour, so a community that never touches the setting announces exactly as it did before.

- **Bulk-remove consumed release bookmarks** ([#296](https://github.com/orphic-inc/stellar-api/issues/296)) — the bookmark list is a consumption queue, but it was read-only once a member started grabbing from it: clearing the releases you had already consumed meant unbookmarking them one at a time. `DELETE /api/bookmarks/releases/consumed` now removes the caller's release bookmarks for any release they hold a live (`COMPLETED`) `DownloadAccessGrant` on, returning `{ removed: n }`. A release fans out to many contributions (editions/rips), so a single grab clears the bookmark; a reversed grant (claw-back flips the status to `REVERSED`) does not count, while a Freepass/Neutralpass grant does, since the member still downloaded it. Self-scoped and idempotent — `removed: 0` is a success, not a 404. The paired stellar-ui "Remove consumed" button is tracked downstream.

### Changed

- **Toolchain and dependency refresh** — the bulk of this release. Node moves to 24 (`engines` widens from `>=22 <23` to `>=22 <25`) and the lint stack crosses two majors: **eslint 8 → 9** with the eslintrc config migrated to flat config ([ADR-0034](docs/adr/0034-eslint-9-flat-config-and-the-import-plugin-ceiling.md), which also records the two import rules suppressed and why), `@babel/eslint-parser` dropped in favour of `@eslint/js` + `globals`, and `eslint-config-prettier` 8 → 10. Flat config has no `--ext`, so `npm run lint` is now plain `eslint src prisma`. **husky 8 → 9** changes the install invocation (`husky install` → `husky`), **lint-staged 13 → 17**, `@types/node` 20 → 24, `eslint-plugin-import` 2.27 → 2.32, `eslint-import-resolver-node` 0.3 → 0.4, `eslint-plugin-prettier` 5.0 → 5.5, and **katex 0.16 → 0.18**, kept in lockstep with the copy stellar-ui bundles. Prettier 3.9 reformatted the tree. None of it changes runtime behaviour. The CI test gates were also split so one failing gate can no longer mask another.

- **Community membership is the role union, and staff surface as Curators** ([ADR-0033](docs/adr/0033-community-membership-and-the-curator-role.md)) — membership was read off a single role, so a member holding both the consumer and contributor roles was classified by whichever happened to be checked first. Membership is now the union of the consumer, contributor and staff roles, evaluated through one shared access predicate instead of being re-derived at each call site, and the staff role is presented to members as **Curator**.

- **`User.ratio` is computed at read time, not stored** ([#294](https://github.com/orphic-inc/stellar-api/issues/294)) — the column was a denormalization of `computeRatio(contributed, consumed)`, a pure function of two adjacent columns, and it appeared in no `WHERE` and no `ORDER BY` (the top-10 user ranking orders by contribution/consume _speed_, never ratio), so the stored copy bought no query performance and only created drift surface. Every read site now derives it — `auth.ts`, `profile.ts`, `search.ts`, and both the ORM and raw-SQL branches of `top10.ts` — and every response payload still carries `ratio`, so the API contract is unchanged. Two dead columns go with it: `ratioWatchDownload`, superseded by `RatioPolicyState` (which carries `consumedAtWatchStart` and derives the watch-period delta), and `totalEarned`, which nothing read. `canDownload` stays — it is an independent download-capability flag read as a hard gate on the grant path, documented in the schema as such rather than a projection of ratio.

### Fixed

- **Site stats no longer count the reserved System user** — `totalUsers` included the internal System account that seeds built-in content, so every install reported one more member than it actually had. The System user is excluded from the total.

- **Stored asset bytes convert explicitly at the Prisma boundary** — binary assets crossed the ORM boundary without an explicit conversion, leaving the byte payload dependent on driver-level coercion. The conversion is now explicit at the boundary.

- **Balance claw-backs floor at zero instead of going negative** ([#294](https://github.com/orphic-inc/stellar-api/issues/294)) — the download-reversal and request-unfill/refund paths decremented `contributed`/`consumed` unclamped while computing the derived ratio from a floored value, so a balance set out-of-band below the reversed amount (as the e2e seed does, and any future staff balance-adjustment would) could be driven negative. A single tested `floorSub` helper now floors every reversal site at zero.

## [0.8.2] — 2026-07-22

### Added

- **Server-side BBCode transcription — the API is now the single source of BBCode rendering** ([#398](https://github.com/orphic-inc/stellar-api/issues/398), [#402](https://github.com/orphic-inc/stellar-api/issues/402), [#403](https://github.com/orphic-inc/stellar-api/issues/403)) — every prose surface stored raw BBCode and left each client to parse it, so the UI shipped a second, drifting transcriber. A content-addressed BBCode subsystem (`lib/bbcode/`) now renders raw BBCode to sanitized HTML at read time, cached by content hash, behind one seam (`modules/bbcodeRender.ts`): **Phase 1** re-authored the built-in wiki seeds in the BBCode dialect and wired the wiki read path to emit an additive `bodyHtml`; **Phase 2** extended that render-at-read to forum posts, comments, collages, releases, contributions and staff bios (each gains `bodyHtml`/`descriptionHtml`/`staffBioHtml` beside its unchanged raw field), and moved profile info to store raw BBCode with a rendered `profileInfoHtml`; **Phase 3** added the `[tex]` tag as server-side KaTeX, emitting MathML + HTML spans (and a little inline SVG) and widening the authoritative DOMPurify allowlist to pass that surface. The rendered field is additive — the raw field still round-trips the editor — and the API's allowlist is the authority the UI mirrors (stellar-ui [#207]). The legacy client parser is retired downstream.

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

[Unreleased]: https://github.com/orphic-inc/stellar-api/compare/v0.8.3...HEAD
[0.8.3]: https://github.com/orphic-inc/stellar-api/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/orphic-inc/stellar-api/compare/v0.8.1...v0.8.2
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
