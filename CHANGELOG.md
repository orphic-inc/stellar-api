# Changelog

All notable changes to stellar-api are documented here.

---

## [Unreleased]

### Added

- **Inactivity lifecycle — a dormancy sweep, and a way back in**
  ([#279](https://github.com/orphic-inc/stellar-api/issues/279),
  [ADR-0038](docs/adr/0038-inactivity-is-a-clock-not-a-timestamp.md)) —
  accounts were only ever disabled by hand, and a disabled member had no route
  back: login answers `403` before it even checks the password, so the existing
  recovery flow could hand them a working password they still could not use.

  A daily sweep warns at 110 days idle (System PM + email), and disables at 120
  provided the warning went out at least 7 days earlier — the gap is measured
  from the stamp, not the calendar, so a job that was down for a month cannot
  warn and disable in one catch-up pass. Signing in clears the warning. Donors,
  `rankLocked` accounts, staff ranks and already-disabled accounts are exempt.
  Accounts that registered and never returned are swept after 7 days, but only
  **self-registered** ones: an account staff created for someone away for a
  fortnight should not be disabled before they arrive.

  **It is off by default and stays off until someone turns it on.**
  `INACTIVITY_MODE` is `off` / `dryRun` / `on`; `dryRun` evaluates every
  candidate and writes nothing, and the count it prints against real data is
  what makes enabling it a decision rather than a hope.
  `INACTIVITY_MAX_DISABLES_PER_CYCLE` (default 50) bounds a live run — warnings
  are uncapped, since signing in undoes one, while a disable needs staff.

  **`POST /auth/reactivation-request` and `/auth/reactivation-confirm`** let a
  disabled member ask to be reinstated: the first mails a link, the second opens
  a staff-inbox ticket that staff resolve through the existing `users_disable`
  surface. Open to **any** disabled account, moderator actions included — it is
  an appeals channel, and filtering by reason would leak which members were
  banned. Both answer one generic sentence for an unknown, active or disabled
  address alike. Confirm is idempotent per member, so one email round-trip
  cannot become an unlimited supply of threads.

### Changed

- **A recovery token now says what it is for** — `AccountRecovery.purpose`
  (`PasswordReset` | `Reactivation`), defaulted so every existing row keeps its
  meaning. `resetPasswordWithToken` matched _any_ unused, unexpired row, so
  without this a reactivation link mailed to a four-month-dormant address would
  also set that account's password. `persistRecoveryToken` now scopes its
  invalidation by purpose, so asking to be reinstated no longer silently expires
  a password reset already in flight.

- **Re-enabling a user stamps `reactivatedAt` and clears the dormancy warning.**
  The handler previously wrote `disabled: false` and nothing else, which would
  have let the new sweep re-disable a reinstated member within 24 hours — the
  clock reads `max(lastLogin, dateRegistered, reactivatedAt)` for exactly this
  reason.

- **`ReleaseGroup` — cross-community content identity**
  ([#265](https://github.com/orphic-inc/stellar-api/issues/265),
  [ADR-0023](docs/adr/0023-contribution-package-and-releasegroup-identity.md))
  — the identity node above `Release`, so "the same album" catalogued in two
  communities can be resolved as one thing. It carries **identity only**: title,
  cited artist, year and the member releases. No editions, contributions or
  files, which stay on the community-scoped `Release` — as does community
  attribution, so CommunityScore, the health pulse and link-health are
  untouched.

  **ADR-0023 moves from Proposed to Accepted**, and its open sub-decision is
  resolved in both halves it actually contained: a group with no
  viewer-visible member answers **404**, and a collage **omits** the entry
  rather than rendering an identity-only placeholder. Answering only one of
  those is what left it open across two sessions.

  **Three operations.** `GET /api/release-groups/{id}` resolves a group for the
  current viewer; `POST /api/release-groups` is find-or-create;
  `PUT /api/communities/{communityId}/releases/{releaseId}/release-group`
  attaches or detaches a release. Named `release-group`, not `group`, because
  in the community routes "group" already means a _release_ — legacy vocabulary
  the new identity must not collide with.

  **The read filters and the write refuses**, which is the distinction
  `communityAccess.ts` documents, applied one level up. A group spans
  communities, so resolving its members is search-shaped: it uses
  `communityReadableWhere` in the same fragment `search.ts` applies, and a
  member the viewer cannot reach is simply absent. The attach route names one
  community in its path, so it is browse-shaped: `assertCommunityAccess`
  answers 403, and you may only group releases you can already reach.

  **The 404 is unconditional — there is no staff bypass.** No community-scoped
  release read in this codebase has one and `communityAccess.ts` holds no
  permission check at all; the newest leak surface was not the place to
  introduce the first. It is also the _same_ 404 with the same message as a
  group id that does not exist, so the two stay indistinguishable and the
  endpoint cannot be used as an existence oracle for private catalogues.

  **Duplicates are prevented, not merely repairable.** Uniqueness is enforced
  on a normalized `identityKey` derived from `lower(trim(title))`, `artistId`
  and `year`, so `Greatest Hits` and `greatest  hits` are one identity.
  `@@unique([title, artistId, year])` could not do this: Postgres treats NULLs
  as distinct and Prisma 6 rejects `nullsNotDistinct`, so artist-less and
  year-less groups would still accrete. The key is JSON-encoded rather than
  `|`-joined so a title containing the separator (`AC|DC`) cannot collide with
  a different identity, and it is never exposed in a response.

  **The group cites its artist rather than copying the name.**
  `ReleaseGroup.artistId` joins the **NOT FILTERED** half of the `Artist`
  soft-delete invariant, alongside release credits — withdrawing a catalogue
  entry must not blank a group's identity line. Creating a _new_ citation still
  requires a live artist and answers 400 otherwise; that is a different
  question from preserving an existing one.

  `CoverArt` and `GroupLog` stop being unreferenced legacy stubs and gain real
  foreign keys with cascade. `GroupLog.communityId` is dropped: a group spans
  communities, so a community-scoped column on its log was a category error.
  Both tables were empty by construction — nothing in the tree had ever written
  either — so the rewrite carries no data risk. Merge, split, covers and the
  group log itself are the follow-on; they need no further migration.

- **Release groups can be merged, split, retitled and given cover art**
  ([#265](https://github.com/orphic-inc/stellar-api/issues/265)) — the curation
  half of the identity work. Seven operations: `PUT /api/release-groups/{id}`,
  `POST .../{id}/merge`, `POST .../{id}/split`, `GET .../{id}/log`, and
  `GET`/`POST`/`DELETE` on `.../{id}/covers`. **No migration** — PR1 landed the
  foreign keys these need.

  **Every verb inherits the read boundary rather than getting a moderator
  bypass.** Merge, split and retitle require `contributions_manage`, but they
  all go through `resolveGroupForViewer` first, so the permission says what you
  may _do_, not what you may _see_: a moderator still cannot reach a group whose
  every member sits in a community they cannot see. One consequence is worth
  stating outright — **you cannot merge into a memberless group**, because a
  memberless group resolves for nobody. Rename that group instead, which is what
  was meant.

  **Merge has no undo.** The source's releases, covers and log entries move to
  the target and the source is deleted; the group log is the record, and a
  two-step confirmation belongs in the UI. Ordering inside the transaction is
  load-bearing: `GroupLog.releaseGroupId` cascades, so the log rows are
  repointed **before** the source is deleted. Reversed, the merge would destroy
  exactly the history it exists to preserve — and the response body would look
  identical, which is why the spec asserts call order rather than payload. A
  cover the target already carries is dropped rather than failing the whole
  merge on a duplicate image, since two groups being merged are likely to share
  artwork.

  **Split takes an identity, not just a release list.** The target is found or
  created by the same normalized key `POST /release-groups` uses, so a split can
  move releases into an existing group instead of only ever minting a new one.
  Deriving the title from a moved release would be wrong more often than right —
  the release being split out is precisely the one that was mis-grouped. Only
  releases actually in the source group move; an id from elsewhere is ignored
  rather than quietly re-grouped. An emptied source group is left in place,
  because a memberless group is not an anomaly here.

  **Retitling onto an identity another group holds answers `409` and names
  that group**, rather than folding into it. That collision is structurally a
  merge, and an edit that silently destroyed a row with no undo is more power
  than a rename should carry — so the destructive act stays behind the verb that
  logs it.

  **Covers are curation, not moderation**: adding one needs only the ability to
  reach the group, exactly like attaching a release. Removing your own is
  likewise open; removing someone else's needs `contributions_manage`. Cover
  URLs must be `https`, since a cover renders in every viewer's browser and a
  plain-http source is a mixed-content failure rather than a style preference.

  `hidden` group-log rows are filtered out for anyone without
  `contributions_manage`. **Nothing writes one yet** — the filter is enforced
  now so that whoever adds the first hidden row does not also have to remember
  to add the filter.

- **Releases carry their release group** ([#605](https://github.com/orphic-inc/stellar-api/issues/605),
  [ADR-0037](docs/adr/0037-group-dedup-is-a-read-time-projection.md)) — the
  release detail read and every `/search/releases` hit now carry an additive
  `group` of `{ id, title, artist, year, image }`, from one shared projection so
  the label cannot drift between the surfaces that show it. `image` is the
  group's oldest `CoverArt` and null when it has none; `release.image` is
  unchanged and remains the release-local fallback.

  **Identity inlines, membership does not.** Seeing a release already entitles a
  viewer to its group's identity, so this needs no gate of its own — but the
  sibling releases still come only from `GET /release-groups/{id}`, which
  filters them per viewer.

  **Search attaches the group rather than collapsing onto it.** Pagination and
  `total` are untouched, so a cross-community duplicate is now labelled as the
  same album instead of silently removed from a count that would no longer
  match its list.

  `releaseGroupId` is **documented** on the release detail response for the
  first time. It has always been sent — the handler spreads the full Prisma
  payload — but the contract did not list it, so a generated client could not
  see it. That is why the group panel could not be built against the API.

- **Collages collapse "the same album" onto one entry**
  ([#605](https://github.com/orphic-inc/stellar-api/issues/605),
  [ADR-0037](docs/adr/0037-group-dedup-is-a-read-time-projection.md)) — a
  collage holding one album under two communities' releases now renders it
  once. `GET /collages/{id}` collapses entries sharing a release group onto the
  first of them, and `numVisibleEntries` counts the collapsed list, which is
  what that field was added for.

  **Nothing is dropped.** The surviving entry carries `groupedWith`, naming
  every entry it absorbed with its `id`, `releaseId`, `communityId`, `title`,
  `userId` and `addedAt` — so each stays addressable by delete (keyed on
  `releaseId`) and reorder (keyed on entry `id`), and keeps its own adder,
  because delete permission is per row and two collapsed entries can have two
  different adders. Both fields are additive; `numEntries` is unchanged and
  remains the true total.

  The collapse is safe because it runs on the already-filtered entry set — it
  applies no access rule of its own, so `groupedWith` can only ever name
  releases the viewer can already see. `CollageEntry` keeps
  `@@unique([collageId, releaseId])`: dedup at entry time was refused, because
  a group-level refusal would tell the adder that a release they cannot see
  exists in a community they do not belong to.

- **`GET /api/search/release-groups` — dedup with a count you can trust**
  ([#605](https://github.com/orphic-inc/stellar-api/issues/605),
  [ADR-0037](docs/adr/0037-group-dedup-is-a-read-time-projection.md)) — where
  `/search/releases` attaches a group to each hit and keeps its own pagination,
  this makes the **group the row**, so `total` counts albums rather than
  releases and a cross-community duplicate is one result.

  It takes every filter the release search takes, and those decide which
  **groups** match. Each result carries the members this viewer may see, which
  is a different set on purpose: a group matched by one release still shows
  every version of that album the viewer can reach.

  Orders by group fields only. Ordering by member count is deliberately absent —
  only the whole relation can be counted, not its visible part, so it would rank
  groups by a number that includes members the caller cannot see.

  Returns only releases that have been grouped, which is honest for an endpoint
  named for groups: `releaseGroupId` is never backfilled, so an uncurated
  catalogue returns nothing here and `/search/releases` stays the complete list.

### Fixed

- **Global release surfaces served release identity to authenticated
  non-members** ([#607](https://github.com/orphic-inc/stellar-api/issues/607),
  [ADR-0036](docs/adr/0036-release-identity-is-community-private.md)) — a route
  that names a community in its path inherits a gate from the path. A collage,
  a profile, a chart or the homepage had nothing to inherit and no shared rule
  to reach for, so seven surfaces served titles, artists, years and cover art
  from communities the caller had no access to.

  **Reads now filter.** `GET /collages/{id}` omits entries whose release the
  viewer cannot reach; `GET /profile/user/{id}` scopes the recent-contributions
  block and the collage-shelf covers to the reader, so two members see
  different things on the same profile; `GET /bookmarks/releases` omits a
  bookmark whose release moved out of reach; `GET /random/release` draws from
  the viewer's own scope, on the count as well as the pick.

  **Two writes now refuse.** `POST /collages/{id}/entries` and
  `POST /bookmarks/releases/{releaseId}` answer **404 — the same status and the
  same message as a release that does not exist**, so the two cases cannot be
  told apart. A 403 would confirm the id is real and private. These are the
  sharper half: a filtered read leaks what the caller could reach anyway, but a
  write that accepts an unreachable id let a non-member _plant_ a
  private-community release in a global collage and publish it to everyone who
  opened it. The bookmark route is a toggle and only its **create** arm is
  gated — rows already written are left in place, so gating the whole route
  would trap a member who lost community access with a bookmark they could
  neither see nor remove.

  **`GET /collages/{id}` gains `numVisibleEntries`**, additive. `numEntries`
  keeps one meaning everywhere — it is a browse sort key and the quantity the
  per-collage quota is enforced against — so it cannot become viewer-dependent.

  **Featuring is now an act of publication.**
  `POST /announcements/album-of-month` refuses a release outside a public
  community at **set** time rather than filtering at read time, so the decision
  sits with the staff member making it instead of silently emptying the
  homepage. The same check closes a pre-existing hole: `FeaturedAlbum.groupId`
  carries no foreign key, so a dangling feature was already possible and
  `/home/featured` rendered null for it without explanation. The operation's
  existing 400 covers it; no new status. The vanity-house slot is a query
  rather than curation, so it takes the public-community predicate.

  Rows already written are **not** purged. A collage entry or bookmark pointing
  at a private-community release was never malformed — it was a row nobody
  filtered on read — and it reappears correctly if that viewer later joins the
  community.

- **An artist's discography silently dropped every release belonging to no
  community** ([#607](https://github.com/orphic-inc/stellar-api/issues/607),
  [ADR-0036](docs/adr/0036-release-identity-is-community-private.md)) —
  `GET /api/artists/{id}` filtered credits with a hand-rolled
  `release: { communityId: { in: [...] } }`, and **a bare relation filter
  excludes a NULL relation**. `Release.communityId` is nullable, so such a
  release matched nothing and vanished from every discography. It failed
  **closed**, which is why nobody reported it: the symptom is an absence.

  The filter is now the shared `releaseVisibleToViewer` predicate, which
  carries the `communityId: null` arm. This **widens** what the endpoint
  returns — the one effect of ADR-0036 that adds rows rather than removing
  them. The extra `community.findMany` the id list required is gone with it.

- **`GET /api/top10/releases` answered 500 on every call, and now ranks only
  public communities**
  ([#608](https://github.com/orphic-inc/stellar-api/issues/608),
  [ADR-0036](docs/adr/0036-release-identity-is-community-private.md)) — all
  three ranking branches selected and joined `releases."artistId"`, a column
  dropped by #72 when role-based `ReleaseArtist` credits replaced it. The
  endpoint has been raising `column r.artistId does not exist` ever since. The
  credited artist is now derived through `primaryArtist`, the same helper every
  other release read uses, so the rule has one home rather than a second copy
  in SQL. The response shape is unchanged — `artistId` and `artistName` are
  still present and still non-null.

  It survived a release because **every unit spec mocks `$queryRaw`, and a mock
  cannot fail on a column that does not exist**, while no integration test
  covered top10 at all. `src/integration/top10Chart.integration.ts` closes that
  gap against a real database.

  The chart now also ranks **only releases in public communities** — a release
  in a `closed` or `invite` community is absent for everyone, including that
  community's own members, who see their own rankings through the
  community-scoped surfaces. This is the first slice of ADR-0036. It is a
  product decision rather than a security one: ranking per viewer would make
  "the #1 release this week" something the site cannot state, and preserving
  the global ranks with gaps would tell a non-member exactly how many hidden
  releases outrank what they can see. Releases belonging to no community are
  kept — that column is nullable, and such a release was never private.

  **ADR-0036 §2 is amended in the same change.** It had said top10 would stop
  using `$queryRaw`; two of the three branches have no Prisma expression, since
  `DownloadAccessGrant` reaches a release only through its contribution and
  `groupBy` cannot group across a relation.

- **Ordered lists could return tied rows in any order**
  ([#613](https://github.com/orphic-inc/stellar-api/issues/613)) — `orderBy` on
  a non-unique column leaves the row order unordered by contract, and Postgres
  may return tied rows differently between two requests. Twenty-six reads now
  end in a tiebreak.

  **Where a limit was involved, a tie decided membership rather than
  arrangement.** Which tags chart (`top10`), who appears on the staff
  leaderboard, which user agents are listed, and which four covers a collage
  shelf shows were all resolved arbitrarily. Three paginated reads —
  release search, the request list, and the user chart — could show a row on
  two pages or on none, because `skip` and a tie together drop and duplicate
  rows rather than reorder them.

  `GET /api/forums` demonstrated it on every install: the seed numbers forums
  10/20/30 within each category, so six forums share `sort = 10` across the
  table, and that list is ordered globally.

  The tiebreak is `{ id: 'asc' }` everywhere, whatever the primary direction —
  one rule to verify by eye rather than a per-site judgment. The three
  `groupBy` reads tiebreak on their `by` column, which is all Prisma exposes
  there, and `UserSecondaryRank` on `userId`, having no `id` of its own. No
  response shape, status code or migration changes.

  A drift spec derives its exemptions from the datamodel rather than a list: a
  column is exempt when it is unique in every model that has one by that name,
  or a `DateTime` in every such model. The `DateTime` exemption is what leaves
  the deferred `createdAt` sweep out of scope. Three dynamically-built
  orderings carry the tiebreak but cannot be seen by it, and the spec says so.

## [0.9.3] — 2026-09-09

### Added

- **`[mature]` BBCode gains a per-viewer gate**
  ([#400](https://github.com/orphic-inc/stellar-api/issues/400)) —
  `UserSettings.showMatureContent` decides whether the tag renders its content
  or a fixed notice. Rendering is now viewer-dependent, so `BBCtx.viewer` is
  **required** rather than optional: a call site that forgets to thread it is a
  compile error, not a silently ungated render. All 21 render sites were updated
  in one pass for that reason.

  **The issue was wrong on two counts and both are corrected on it.** It asked
  for the column on `User` "matching the existing `show*` convention", but all
  five `show*` fields live on `UserSettings`. And it specified
  `@default(false)`, which would have hidden every `[mature]` block from every
  member with no way to re-enable it, because stellar-ui has no control for this
  setting yet. The default is **`true`**, so members opt out and today's
  rendering is preserved.

  **This is a display preference, not an access control**, and the contract now
  says so. `bodyHtml` omits the gated content, but the raw `body` still ships in
  the same response so the editor round-trips (#402). Making it a real control
  means withholding `body`, which is a response-shape change and belongs in its
  own issue.

  **The author's `[mature=...]` argument is discarded when the gate is closed.**
  Passing the summary through would leak the payload for exactly the content
  most likely to need gating, since the label is written by the same person as
  the content. The replacement notice is a `<div>`, not a `<p>`: `p` is absent
  from the sanitizer's allowlist, so DOMPurify would have stripped the wrapper
  and taken the class stellar-ui needs with it.

  **The render cache varies on the viewer only when the content actually
  contains a `[mature]` tag.** Ordinary prose renders identically for both
  viewers, so keying it per viewer would store two copies and double a cache
  that has no eviction bound. The predicate is case-insensitive because the
  tokenizer lowercases tags, and deliberately conservative: a false positive
  costs one cache entry, a false negative lets two viewers share one.

  Six unit tests and four integration tests cover it, and each was **proved by
  breaking it** — disabling the gate fails four, collapsing the cache key fails
  three. One integration assertion pins the query count at one per request
  rather than one per row, which is the regression a later refactor would
  otherwise introduce silently.

  The stellar-ui half is
  [ui#311](https://github.com/orphic-inc/stellar-ui/issues/311).

- **A gate for the 500-on-a-well-formed-request class**
  ([#564](https://github.com/orphic-inc/stellar-api/issues/564)) —
  `npm run prisma:guard-coverage`. The global handler is `err.statusCode ?? 500`
  with `FieldError` its only special case, so no Prisma error code is mapped
  anywhere: a constraint violation reports a **client** mistake as a **server**
  error, logged at `log.error('Unhandled error')` rather than `log.warn`.

  **The issue published four counts — 8, 12, 15, 18 — and every one was wrong**,
  because the rule lived in prose and each hand-application missed a different
  half. This ships the rule as code so the number is re-derived instead of
  quoted. It changes no behaviour; it establishes the measurement.

  **The rule has two arms, and every earlier tally described only the first.**
  Arm A is `create`/`upsert` where the model owns an FK or a `@unique`
  (P2003/P2002). Arm B is `update`/`delete` addressed by id, which throws
  **P2025 for a missing row on ANY model** — which is why `PUT /announcements/{id}`
  500s on `News`, a model with neither constraint. The `*Many` variants are
  excluded: they no-op on zero rows rather than throwing.

  **Three things a regex could not see, and each maps to a specific miscount.**
  Mutations inside `$transaction(async tx => ...)` are `tx.*` and appeared in no
  previous tally. A client held under another name is invisible to a
  receiver-keyed scan — `lib/audit.ts` writes through
  `(client as PrismaClient).auditLog.create`, and keying on the model name
  instead found 26 further sites. And whether a call sits inside a `try` whose
  `catch` translates a Prisma code is a question about block nesting. It uses
  the TypeScript compiler API, already a dependency, so this adds none.

  **Current reading: 577 mutation sites, 423 needing a guard, 9 already guarded,
  116 unreviewed in `src/routes/`, 300 counted in `src/modules/` + `src/lib/`.**
  Only `src/routes/` is gated — a module takes its ids as function arguments, so
  request-supplied cannot be told from internally-read without inter-procedural
  analysis, and gating on a rule that cannot discriminate is noise rather than a
  gate. Reporting that remainder as a number retires the "unmeasured" caveat the
  issue carried.

  The baseline is a ratchet on `openapiCompleteness`'s three rules, and all
  three are asserted by constructing the state they must reject. `unreviewed` is
  a burn-down; `internallyDerived` records sites whose constrained ids cannot
  dangle, **each with its reason** — a prior `findUnique` is explicitly not a
  reason, since it leaves the TOCTOU window the original report observed on
  `/bookmarks`. Entries key on the semantic owner rather than `file:line`:
  keying on `file::model.op` would collapse 116 of the sites into 54 entries,
  so clearing one would silently clear up to nine others.

### Fixed

- **`showMatureContent` was unreachable from the settings UI it was built for**
  ([#400](https://github.com/orphic-inc/stellar-api/issues/400)) — #400 added the
  field to `userSettingsSchema` and taught `updateProfile` to write it, but not
  to `profileUpdateSchema`. `validate()` assigns the **parsed** body (`req.body =
data`) and Zod strips unknown keys, so a `PUT /api/profile/me` carrying
  `showMatureContent` answered `200` having written nothing — and the settings UI
  submits through that door, not `PUT /api/users/settings`. The control was inert
  before any UI existed to expose it.

  **A silent strip has no failing surface**, so the fix ships with one:
  `schemas/settingsParity.spec.ts` asserts every `userSettingsSchema` field is
  writable through `/profile/me` too, and that the profile door's only extra
  fields are the four `Profile` columns. It fails on the pre-fix schema, which
  was verified rather than assumed.

  `lib/bbcode/bbcode.spec.ts` now also pins the gated notice as an **exact**
  string rather than a `toContain`. stellar-ui injects a settings link into that
  markup keyed on its class ([ui#311](https://github.com/orphic-inc/stellar-ui/issues/311)),
  and the API deliberately embeds no UI route of its own, so the two ends are
  coupled through this markup and nothing else. A `toContain` would let the
  wrapper, class or copy drift while passing, and the ui failure is silent — the
  transform stops matching and the notice renders as unlinked text.

  Additive to the contract: one optional boolean on the `PUT /profile/me` request
  body. No shape narrows and coupling stays at `0.9`.

- **Bookmarking a nonexistent artist, release, community or request answered 500**
  ([#564](https://github.com/orphic-inc/stellar-api/issues/564)) — the four
  `POST /api/bookmarks/{segment}/{id}` toggles wrote a path id straight into a
  `create`. `validateParams` proves only that it is a positive integer, and the
  relation is a hard foreign key, so a well-formed request naming nothing raised
  a Prisma P2003. That error carries no `statusCode`, so the global handler
  reported a **client** mistake as a **server** error and logged it at
  `log.error('Unhandled error')`. They now answer **404**.

  **The remove arm was a second, quieter instance.** It used `delete`, which
  throws P2025 when the row disappears between the toggle's read and its write —
  the concurrent-double-click race the issue's original report named. It now uses
  `deleteMany`, which no-ops on zero rows, so that arm cannot 500 by
  construction rather than by catching.

  **A lost unique race answers `200`, not `409`.** Two concurrent POSTs on the
  same pair leave one losing P2002, but its caller asked to bookmark and the
  bookmark exists: a toggle reports what is true now rather than that someone
  else got there first. This is a deliberate exception to the P2002 → 409 rule
  in `AGENTS.md`, which is written for creates that assert novelty.

  Contract: the four `post` operations gain a `404`, and the comment on
  `registerBookmark` that recorded why one could not be declared is now the
  explanation of why it can. `delete` still declares none — `deleteMany` answers
  `204` whether or not a bookmark was there. Four entries move out of
  `noFailureModes` (154 → 150) and eight out of the guard-coverage baseline
  (116 → 108), four of them because the write is no longer a candidate at all.

  Tests are parametrised across all four segments rather than covering one as
  representative: the guard is hand-written four times, since extracting it into
  a helper would put the `try` outside the handler where the lexical
  guard-coverage checker cannot see it.

- **`/announcements` declared a 404 that could not fire**
  ([#564](https://github.com/orphic-inc/stellar-api/issues/564)) — `PUT`/`DELETE
/announcements/{id}`, `DELETE /announcements/blog/{id}` and `DELETE
/announcements/global-notice/{id}` addressed a row by id with no existence
  check. Prisma raises **P2025** for a missing row, that error carries no
  `statusCode`, and so the handler answered **500** while the contract asserted
  a `404`. stellar-ui could hold a 404 branch that never ran while the 500 that
  actually arrived went unhandled. **Fixing the handlers makes the existing
  contract true rather than changing it** — no operation gains a code, and
  nothing moves in `openapi-failure-coverage-baseline.json`.

  **`News` carries neither a foreign key nor a unique constraint**, which is why
  the constraint-only reading of #564 filed these four as safe. That is the
  whole of arm B, and an integration test now pins it against a real database —
  including a guard on the premise itself, so that adding a constraint to `News`
  later cannot make the assertion pass for the wrong reason.

  **Three more on the same surface that the issue's queue did not list.**
  `DELETE /announcements/album-of-month/{albumId}` was called out on the issue as
  the _correct_ sibling because it reads before deleting; it keeps that read for
  the message and gains a catch, since a read alone leaves the window between it
  and the write. `POST /announcements/blog` and `POST /announcements/global-notice`
  are recorded as internally derived: each model's only foreign key is the
  author, taken from `req.user.id`, and a session-derived id cannot dangle.

  Guard-coverage baseline: **108 → 101 unreviewed**, 13 → 18 guarded, and the
  first two `internallyDerived` entries, each with its reason. The four declared
  404s also stop saying `Not found` and say which thing was not found.

  Fixes the checker's own `--write` log, which reported the count **before**
  filtering out `internallyDerived` and so printed a total the next run
  contradicted.

- **`/artists`, `/forums` and `/tools`: 19 constraint violations that answered
  500** ([#564](https://github.com/orphic-inc/stellar-api/issues/564)) — one pass
  over three surfaces the issue's queue put at **8** between them. The checker
  finds **19**, and on `/forums` a _different_ three from the ones the queue
  named: it listed `POST /forums`, `topic-notes` and `polls`, where the real set
  is the two category writes, the forum update and the last-read upsert.

  **Sixteen sites gained a guard.** Path ids answer `404`
  (`PUT /artists/{id}/vanity-house`, `POST /artists/{id}/subscribe`,
  `DELETE /artists/{id}`, `PUT /forums/{id}`, both `/forums/categories/{id}`
  writes, `DELETE /forums/topic-notes/{id}`, and all three `/tools` deletes).
  Body ids answer `400`, because the route exists and the payload is what names
  something absent (`POST /artists/similar`, `/artists/alias`, `/artists/tag`,
  `POST /forums`, `POST /forums/last-read`).

  **P2003 does not say which foreign key failed**, so where two body ids are in
  play the message names both rather than guessing — `Artist or tag not found`,
  `Artist or redirect target not found`.

  **Three sites are recorded as internally derived rather than guarded.** The
  audit writes in the `/tools` deletes take `actorId` from the session, and
  `POST /forums/{id}/catchup` upserts against topic ids it read moments earlier
  in the same request. No client-supplied id reaches a constrained column, and
  #564 is about a well-formed request naming something absent.

  **Thirteen of the fifteen affected operations already declared the code they
  could not emit**, the same shape as `/announcements`. Only `POST /artists/similar`
  and `POST /artists/tag` gain a declaration — a `409` for a lost upsert race,
  which unlike the `/bookmarks` toggle is not idempotent: the tag upsert
  increments a vote, so a swallowed race would silently under-count.

  Guard coverage: **101 → 82 unreviewed**, 18 → 36 guarded, 2 → 3 internally
  derived. Failure coverage: 214 → 216 declaring, 150 → 148 verified silent.

- **`/collages` and `/users`: 27 constraint violations that answered 500**
  ([#564](https://github.com/orphic-inc/stellar-api/issues/564)) — and
  `/collages` is the surface the issue names as its **negative control**: _"nine
  candidates that are all guarded by `loadActiveCollage`, so `/collages` is NOT
  affected."_

  That was true under the rule it replaced. `loadActiveCollage` is `findUnique` +
  `throw new AppError(404)` — a **read**. It answers the ordinary case and leaves
  the window between itself and the write, which is the race #564's own report
  observed. Under the corrected rule the surface has **seventeen** affected
  sites, not zero, and `/users` has ten more that appear in no tally at all
  because every one of them is the same read-then-write shape.

  **Two sites are fixed by construction rather than by catching.**
  `GET /collages/{id}` touches a subscription's `lastVisit` as a side effect of a
  READ; `update` raised P2025 if the subscription went away, failing a request
  that only asked to read, so it is now `updateMany`. The bookmark toggle's
  remove arm is now `deleteMany`, matching `/bookmarks`.

  **Toggles report the resulting state.** A lost race on subscribe or bookmark
  answers `200` with what is now true, not `409` — the caller asked to be
  subscribed and they are. `POST /collages/{id}/entries` keeps `409`, because
  there the duplicate is the answer rather than a race artefact.

  **`Collage.name` and `DonorRank.name` carry unique constraints**, so a
  duplicate name answered 500 on create. Both now answer `409`.

  **Nineteen affected operations, and fifteen already declared the code they
  could not emit** — the third surface-set in a row where that holds. Only four
  declarations are new: `409` on `POST /collages`, `POST /users/donor-ranks` and
  `PUT /users/donor-ranks/{rankId}`, and `404` on `PUT /collages/{id}`.

  Guard coverage: **82 → 55 unreviewed**, 36 → 61 guarded — 25 sites gained a
  guard and two stopped being candidates at all. Failure coverage:
  216 → 217 declaring, 148 → 147 verified silent.

  **`collages.ts` gains four small helpers, and that is a consequence of the
  guard rather than a tidy-up.** A guard must sit _lexically_ inside its handler
  for the guard-coverage checker to see it, and each is about ten lines — enough
  to push three handlers past Codacy's per-function limits. The room came from
  moving logic the guard does not touch: `nameTaken`,
  `personalCollageQuotaExceeded`, `entryAddBlocked`, and
  `buildCollageUpdate`/`applyStaffOnlyFields`. Every function in the file now
  measures at or below what it did before this change — 60/8, 48/11, 47/12
  against 60/8, 70/18, 52/14 on `main`.

  Tests live in new spec files rather than appended, and `src/collages.spec.ts`
  measures 858 non-comment lines, under the 1000 limit.

- **`translatePrismaError` — the #564 guard as one call instead of ten lines**
  ([#564](https://github.com/orphic-inc/stellar-api/issues/564)) — every write
  that can violate a constraint needs a catch that translates a Prisma code,
  because the global handler maps none. Written longhand that catch is about ten
  lines, and it has to sit **lexically inside its handler**: `prisma:guard-coverage`
  finds guards structurally, so a catch moved behind a call reports as unguarded.

  **That is a real tension, and it had already cost something.** Five guards took
  three `collages.ts` handlers past Codacy's per-function limits, and four
  helpers had to be extracted to make room. This resolves it: the `try` stays in
  the handler, only the translation moves.

  Migrating the thirty-seven existing pure-throw guards takes **210 non-comment
  lines out of nine route files**, with no function left worse than before.
  `collages.ts` drops from three functions over Codacy's per-function limits to
  one, and that one is a detail read this change does not touch.

  **It does not fit every guard, and the four on `/bookmarks` are the
  counter-example.** Those toggles answer `200` with the resulting state on a
  lost race, and only a _throwing_ arm can be a map entry. Forcing the mixed
  shape through the helper measured **longer**, not shorter, so those stay
  longhand and `AGENTS.md` says why.

  The checker also learns to recognise the helper by name. **This is
  future-proofing rather than a fix**: an inline map like `{ P2025: [404, '…'] }`
  already contains the literal code the existing pattern matched, and the gate
  stays green with the change reverted. It earns its place for a map passed by
  reference, which the checker's own tests now cover.

- **`/communities` and `/wiki`: 18 constraint violations that answered 500**
  ([#564](https://github.com/orphic-inc/stellar-api/issues/564)) — the first
  batch written against `translatePrismaError` from the start.

  **The wiki revision writes are the interesting half.** `WikiRevision` is unique
  on `(pageId, revision)`, so a second editor who saves first takes the next
  revision number and the slower save raised P2002 — a lost edit race reported as
  a server error, telling the caller nothing about reloading. Both the edit and
  rollback paths now answer `409` with a message that says to reload.

  **The membership and curator routes write relations.** `connect`/`disconnect`
  raises P2025 when either side has gone, and the code does not say which, so
  those messages name both rather than guessing.

  **One deliberate departure from the body-id rule.** A dangling `leaderId`
  arrives in the body, which the rule answers `400` — but `POST /communities`
  already answers `404` for exactly that from its own read, and a route
  contradicting itself is worse than the rule bending. Both paths answer `404`.

  Six operations gain a declaration; the other nine already declared the code
  they could not emit, which is now the fourth surface-set running.

  Guard coverage: **55 → 37 unreviewed**, 61 → 79 guarded.

  `wiki.ts` also gains three small extractions — `resolveCreateLevels`,
  `keptLevel` and `EDIT_PAGE_SELECT`. The guards pushed two handlers further past
  Codacy's per-function limits, and a guard cannot move without becoming
  invisible to `prisma:guard-coverage`, so the room came from logic it does not
  touch. **Every function in the file is now inside those limits — `main` had two
  that were not.**

- **The last 37: `prisma:guard-coverage` reads 0 unreviewed**
  ([#564](https://github.com/orphic-inc/stellar-api/issues/564)) — sixteen
  surfaces, none of them big enough to have earned a PR on its own, which is
  exactly why they survived five earlier passes and appear in none of the
  issue's tallies. The gate is what surfaced them.

  **29 sites gained a guard; 8 are recorded as internally derived**, each with
  its reason — a session-derived author, a row addressed by the caller's own
  session id, or an install transaction whose foreign keys it created itself.
  The gated route backlog is now **108 guarded / 11 internally derived / 0
  unreviewed**.

  **Six guard messages were rewritten to match the 404 their own route already
  answers.** `/ip-bans` says `Ban not found`, `/bad-passwords` and
  `/email-blacklist` say `Entry not found`, and so on. Inventing a second wording
  for the same condition would have made a route contradict itself.

  Two operations gain a declaration (`409` on `POST` and `PUT /tag-aliases`); the
  other twenty-five already declared the code they could not emit — the fifth
  surface-set running.

  `friends.ts` and `comments.ts` gain four small extractions, for the same reason
  as the earlier batches: a guard must sit lexically in its handler, so the room
  comes from logic it does not touch. **Across every file this touches, functions
  over Codacy's per-function limits go from four to three — one eliminated, one
  improved, none made worse.**

- **The bookmarks `404` described a community as a `communitie`** — the four
  `POST /bookmarks/*` operations registered their new
  [#564](https://github.com/orphic-inc/stellar-api/issues/564) `404` through one
  helper that derived the noun from the path segment by stripping a trailing
  `s`. Three segments survive that; `communities` does not, and the contract
  shipped `No communitie with that id` to every consumer of `openapi.json`.

  The noun is now passed per call site rather than derived. English plurals do
  not invert by rule, every other description in `lib/openapi.ts` is written
  out, and the helper's doc comment now says so — a second derivation would
  fail on the next irregular segment instead of this one.

  Description-only: one line of `openapi.json` moves, no operation, code or
  body shape changes.

- **A withdrawn artist still surfaced by name through six reads**
  ([#573](https://github.com/orphic-inc/stellar-api/issues/573)) — `DELETE
/api/artists/{id}` is a soft delete, and the direct list, search, count and
  detail reads all honoured it. The reads that reach an artist through a **join
  row** did not, because the sweep that added `deletedAt: null` looked only at
  handlers naming `prisma.artist`.

  Fixed: the similar-artist list and the detail read's `similarTo` / `aliases`
  includes now filter the target; `GET /artists/history/{artistId}` gains a
  parent check, its `data` snapshots carrying the artist's name; and
  `GET /bookmarks/artists` filters, having handed the member a name whose own
  detail route answers **404** — a dead entry in their own list.

  **Filtering the target alone would have fixed half of it.** `GET
/artists/{id}/similar` never read the parent at all, so a withdrawn artist's
  own similar list stayed served to anyone with the id. That direction needs the
  parent check, not a filter.

  **The writes had the mirror gap.** A soft-deleted artist keeps a live row, so
  the foreign key is satisfied and `POST /artists/similar` and `POST
/artists/alias` recorded links the reads then discard — a write reporting
  success with no possible effect. Both now reject a withdrawn id with the same
  **400** and wording their dangling-id arm already answers, since both mean "a
  body id names no usable artist".

- **`/artists` answered 404 on five operations and an empty 200 on four**
  — closing the discrepancy recorded on
  [#575](https://github.com/orphic-inc/stellar-api/issues/575). `GET` and
  `DELETE /artists/{id}/subscribe` now **404** for a missing or withdrawn
  artist, as `POST` on the same path already did: one resource had two answers
  depending on the verb. Unsubscribing stays idempotent — the gate is on the
  artist, so a live artist you were never subscribed to still answers `200
{ subscribed: false }`.

  Four operations gain a `404` (`GET /artists/{id}/similar`, `GET
/artists/history/{artistId}`, `GET` and `DELETE /artists/{id}/subscribe`) and
  leave `noFailureModes`. **None is reachable from stellar-ui today** — its
  history, similar and subscription-status hooks are exported with no consumers,
  and the unsubscribe mutation fires only from a page that already resolved the
  artist.

  Neither `POST` registers a new `400`: both already declare a derived one with
  a `ValidationError` body, and registering a handler `400` would suppress it
  under REGISTERED WINS — trading one inaccurate declaration for another. The
  handler `400` those routes have always been able to send stays undeclared,
  which is #575's standing entry rather than something this change introduces.

- **The `Artist.deletedAt` doc comment now says which relations are exempt.**
  It asserted the invariant without naming the relation reads, so a reader
  checking "is `deletedAt` respected?" found five call sites that said yes. It
  now splits explicitly: **filtered** covers anything presenting an artist as a
  catalogue entry, relation reads included; **not filtered, deliberately**
  covers release credits, contribution collaborators and the artists named on a
  request — a citation of the artist as author of a work that still exists.
  Blanking those is the harm the original exception was written to prevent.
- **A soft-deleted forum post's body was served on the topic list, and a deleted
  topic's title on the forum index**
  ([#598](https://github.com/orphic-inc/stellar-api/issues/598)) — `Forum.lastTopicId`
  and `ForumTopic.lastPostId` are denormalized pointers, and the `onDelete:
SetNull` on both relations fires only for a **hard** delete, which never
  happens here. `deleteTopic` and `deletePost` decremented their counters and
  left the pointers aimed at the row they had just hidden. `deletePost` keeps
  `body` verbatim, and the topic list spread the whole row, so the deleted text
  shipped.

  **Fixed by recomputing the pointer inside the delete transaction, not by
  filtering** — a filter alone would blank the forum index rather than correct
  it, since the previous live topic is the right answer. `deleteTopic` moves
  from a batch to an interactive transaction to do it: the recompute has to read
  live rows after the delete, which a batch cannot.

  The ordering follows the **newest live post**, not topic `createdAt`, because
  that is what the column means — `createPost` sets `lastTopicId` on every post,
  so it tracks activity. Ordering by creation would surface a quiet new thread
  over an old one replied to an hour ago.

  **`trashTopic` already did this, and had both bugs.** It was the worked example
  the delete paths were missing, but it ordered by `createdAt` and did **not**
  filter `deletedAt` — so it could repoint a forum at a soft-deleted topic. All
  three call sites now share one helper.

  The reads that carry these pointers filter as well. That is not redundancy: it
  neutralises rows **already stale** in a deployed database, which the recompute
  cannot reach without a data migration.

- **A contribution served the bodies of deleted comments, and a request bookmark
  its withdrawn title** — same class as the above.
  `routes/api/comments.ts` filters `deletedAt` at its list, its count and its
  detail ([#509](https://github.com/orphic-inc/stellar-api/issues/509) F4); the
  `Contribution.comments` relation was missed by that sweep. `GET
/bookmarks/requests` is the request-shaped twin of the artist bookmark fixed
  in [#573](https://github.com/orphic-inc/stellar-api/issues/573) — one route
  below it in the same file, returning a title whose own route answers 404.

- **`Forum.lastTopic` is now declared nullable.** It was `.optional()` only, so
  a forum whose last topic is filtered or absent contradicted its own contract.
  `ForumTopic.lastPost` was already declared this way. stellar-ui already guards
  with `forum.lastTopic ? …`, so this widens what the contract admits rather
  than changing what the UI does. **It owes an `api:sync`.**

- **`ForumTopic`, `ForumPost`, `Comment` and `Request` gained the two-halves
  `deletedAt` doc comment** `Artist.deletedAt` received in #573 — what is
  filtered, and what is deliberately not. In all four the single exception is
  `reports.ts` resolving a report's URL, which reads ids and routing fields and
  never a body or title. The absence of that statement is why three consecutive
  sweeps each missed the relation reads.

## [0.9.2] — 2026-09-08

### Added

- **A shrink-only gate on whether the contract documents the failures its handlers answer** ([#517](https://github.com/orphic-inc/stellar-api/issues/517)) — the third registry axis. `npm run openapi:failure-coverage` asserts every operation has been **classified**: it declares a 4xx its middleware does not already imply, or it sits in `openapi-failure-coverage-baseline.json` as `unreviewed` (the shrinking burn-down) or `noFailureModes` (a durable record that someone read the handler and found it answers nothing). A new route is in neither list and fails on its first CI run. Opens at **364 routes, 215 declaring at least one handler failure code, 149 unreviewed**.

  **It derives nothing, and that is the point of departure from its two siblings.** #474's authority is the Express route table and #494's is middleware that labels itself, so in both cases the checker reads the thing that does the work. A handler's failure modes have no such structure — **121 of 151 `AppError` throws live in modules**, a call or more from the route, often behind a reason-string map with a `?? 400` fallback. Static analysis would be approximate and a runtime probe has nothing to watch, since the integration suite calls modules directly rather than driving HTTP. So the authority is a human reading the handler, and the gate's narrower job is to ensure the reading happened and has not gone stale.

  **Scope is any 4xx the route's own gates do not imply**, which makes this compose with #494 rather than overlap it. A `403` from `requirePermission` is #494's to measure; a `403` thrown by the handler of an ungated route — `POST /auth/register` answers one on three branches — belongs here. That subtraction is why the opening count is 149 rather than the 154 a naive "4xx other than 401/403" tally gives: five operations already declare a handler-thrown 403 their `auth` gate cannot explain.

  **App-level middleware is excluded by construction.** `rejectBannedIps` answers 403 before routing, so all 364 operations can emit it and none owns it; declaring it 364 times would drown the per-operation distinction #494 spent twenty slices building, and OpenAPI has no top-level `responses` to say it once.

  **What it deliberately cannot see:** an operation declaring _some_ gate-independent 4xx counts as covered, so one declaring 404 while its handler also throws 409 passes. `GET /reports/{id}` is a live example. That is the cost of keeping the codes in the registry alone instead of duplicating them where they could drift — the per-surface read catches it, and a spec pins the behaviour so it reads as a decision rather than a bug. The summary line says _"declare at least one"_ rather than _"documented"_ for the same reason.

- **CI gates duplicate `[Unreleased]` headings, and the section is coalesced to one per type** ([#537](https://github.com/orphic-inc/stellar-api/issues/537)) — `changelog:check` now asserts that each `### <type>` appears at most once under `[Unreleased]`. It is a **shrink-only ratchet against the merge base**, like every other guard here, so a branch fails for duplication it introduced and never for what it inherited — an absolute check would have blocked both open Renovate PRs over a file neither touches.

  **The issue's stated cause is not what is happening.** #537 attributes the duplication to `merge=union` ([#467](https://github.com/orphic-inc/stellar-api/issues/467)). Measured across the six commits between 0.9.1 and this one, every duplicate arrived in its own authoring commit: one clean hunk at the same anchor, with no conflict for a merge driver to resolve. The pattern is that a PR **prepends** its own `### Fixed` block instead of appending under the heading already there — the convention is at fault, not the merge driver. That is also why a per-PR gate can see it at all. The durable half of the fix is the rule now written into `AGENTS.md`; this is its enforcement half.

  The vocabulary is a **closed set** (`Added`, `Changed`, `Fixed`, `Security`, `Docs`, `Removed`) because the `release` job publishes a section verbatim. A typo'd `### Fixes` appears once, so a duplicate rule alone cannot see it, and it would ship as a section nobody meant to write.

  **`[Unreleased]` is coalesced from ten headings to three** — 11 entries in, 11 out, each keeping the type it was authored with, proved by asserting the (type, entry) multiset is unchanged rather than by reading the diff. That hand-coalesce is what misfiled eight entries at the 0.9.1 cut; removing the need for it is the point. `AGENTS.md`'s claim that the `release` job publishes `[Unreleased]` is corrected in the same pass — it publishes the section matching the **tag**, and fails loudly when that section is absent.

- **Staff can curate the password denylist** ([#536](https://github.com/orphic-inc/stellar-api/issues/536)) — `GET`/`POST`/`DELETE /api/bad-passwords` behind a new `bad_passwords_manage` permission, mirroring the `email-blacklist` surface, with `audit()` on both mutations. Entries are normalised on the way in exactly as the lookup normalises on the way out, so a mixed-case row can't be stored-but-unmatchable, and `POST` answers **409** rather than surfacing a unique-constraint 500 for a duplicate.

  **The list is paginated, unlike its sibling.** `/api/email-blacklist` returns an unpaginated `findMany`, which is fine for a handful of staff-added rows; this one ships with 237 seeded entries and only grows, which is the unbounded case AGENTS.md requires pagination for. Deleting a seeded row is durable — the seed's marker guard means it is not restored on the next boot.

  A new enum `BadPasswordSource` (`SEEDED` / `STAFF`) records provenance rather than a `String`, so the registry describes it as the enum it is — [#501](https://github.com/orphic-inc/stellar-api/issues/501)/[#503](https://github.com/orphic-inc/stellar-api/issues/503) removed exactly this class of stringly-typed column.

### Changed

- **A route's gates carry what they enforce, not just that they enforce something** ([#517](https://github.com/orphic-inc/stellar-api/issues/517)) — `markGate` takes an optional permission list and `Operation.gates` becomes `{ kind, permissions? }[]`. Groundwork with no behaviour change: `openapi.json` is **byte-identical**, and all three registry gates read exactly as before.

  The parameter lives on the gate that has it rather than in a second array kept in correspondence with `gates` — two arrays that must agree is the same encoded-twice shape that let 309 of 364 `security` blocks drift before [#520](https://github.com/orphic-inc/stellar-api/issues/520) derived them.

  **`requireOwnerOrPermission` deliberately stamps no names.** An owner passes it _without_ the permission, so naming one would have the contract assert a requirement that is not one. It stamps its kind alone and will derive the generic message its middleware actually sends. `requirePermission` stamps its varargs, and the two admin-only helpers stamp `admin`.

  Nothing reads the names yet, so a wrong or missing stamp would have passed every existing test — four specs assert the stamps directly, including that `requireOwnerOrPermission` carries no `permissions` property at all.

- **The IP ban admin surface accepts IPv6, and refuses ranges it cannot mean** ([#540](https://github.com/orphic-inc/stellar-api/issues/540)) — `POST /api/ip-bans` still takes addresses and returns them, so the API shape is unchanged, but it now accepts IPv6 bounds and rejects a range spanning both address families (the space between them is every IPv4-mapped address plus most of IPv6, which is never what a moderator means). The reversed-bounds check is now correct for ranges the previous signed-`Int` version accepted and then stored unsatisfiably. Its **400** is registered in the contract, which it could always answer and never declared.

- **The email blacklist rejects entries that could never match** ([#540](https://github.com/orphic-inc/stellar-api/issues/540)) — `email` was `z.string().min(1)`, so `known spammer` was accepted, stored, and unable to fire against any address. It now requires an address- or domain-shaped value, surfacing the mistake while the author can still correct it, and is normalised on write exactly as the lookup normalises on read. This is the same reasoning that dropped 24 unreachable entries from the password denylist. **Behaviour change on a staff-only endpoint:** input previously accepted now returns `{ errors: { email: [...] } }`; existing unmatchable rows are left in place.

- **`AGENTS.md`'s documented pagination helper does not exist** — the guide showed `parsePage(req)`, but `lib/pagination.ts` exports `parsedPage(res)`, which reads an **already-validated** query off `res.locals` and requires the route to run `validateQuery` with a schema spreading `paginationBase` first. Following the documented form is a compile error. Corrected to the real contract, along with the response envelope it produces. `BadPassword` is also removed from the "Stub models" table, since it is no longer one.

- **The contract derives the 401 and 403 its gates answer, rather than restating them 495 times** ([#517](https://github.com/orphic-inc/stellar-api/issues/517)) — `responsesForGates` turns a route's stamped gates into the failure responses they imply, and `buildOpenApiDocument` fills in whatever a registration omits. **493 hand-written blocks are deleted.** The gates already knew the answer; [#520](https://github.com/orphic-inc/stellar-api/issues/520) made exactly this move for `security` and stopped, and its own comment said why — _"the difference between them is 401 versus 403, which lives in `responses` already. Encoding it twice in two vocabularies is how the two drift apart."_

  **Registered wins**, so derivation only ever supplies a code nobody wrote down. Two operations keep bespoke wording because each says something the gates cannot: `GET /asset/{hash}` explains why an asset read needs a session at all, and `POST /reports/{id}/unclaim` folds its gate and its handler into one entry, because a caller cannot tell its two 403s apart.

  **The 59 handler-thrown 403s are untouched** — `Not your stylesheet`, `Account disabled`, `Not the recipient`. They have no gate to read, and they are the axis #517 tracks; `openapi:failure-coverage` reads **215 / 0 / 149** before and after, unchanged to the number.

  **Six descriptions get better by being derived**, which is the whole diff on the contract: three vague `Forbidden`s become `Missing recovery_manage`, `Missing the staff permission` and `Missing users_edit permission` lose their trailing noise, and `Missing wiki_manage/admin` becomes `Missing wiki_manage or admin` — the `or` being load-bearing, since **any** of a gate's permissions satisfies it. `POST /stats/snapshot` also stops carrying an inline copy of `MsgResponse` and references the registered schema, which generates the same type. **stellar-ui owes an `api:sync`.**

  **Response codes are merged in ascending order**, the order all 364 registrations were already written in. Appending the derived ones instead would have reordered `openapi.json` for 356 operations and buried the six real changes.

  **[#494](https://github.com/orphic-inc/stellar-api/issues/494)'s gate is deleted — obviated, not fixed.** `openapi:auth-coverage` existed to police the hand-writing; with nothing hand-written left it would have been checking the generator against its own input. The checker, its CLI, its (already empty) baseline, the npm script and the CI step all go, exactly as #520 retired the `security` axis. The sixth of eight guarded axes is now a property of the generator.

  **What replaces it is a spec, and it is narrower than the gate was.** `src/openapiGateResponses.spec.ts` pins the derivation's wording, the registered-wins merge and the ordering, and each was verified by breaking it. It does **not** walk the app: `apiTestHarness` mocks `requireAuth` away, so 214 of the 356 gated routes carry no stamp there and an app-walking assertion would pass against a route table that is not the real one. The real chain is read by `openapi:export`, whose output CI re-derives and diffs, so the committed `openapi.json` is what the spec asserts against instead.

- **The contract derives the `429` its rate limiters answer** ([#553](https://github.com/orphic-inc/stellar-api/issues/553)) — `GateKind` gains `rateLimit`, the four limiters stamp themselves, and `expectedCodes` maps the kind to **429**. **205 operations gain the rate-limit failure they could always answer and never declared**, taking the total from 2 to 207. **stellar-ui owes an `api:sync`.**

  **The issue understates the surface by a factor of 26, and measuring it first is what shaped the fix.** It counts 8 route-level limiter mounts. It misses that `writeLimiter` is mounted **app-level** in `app.ts` for every `POST`/`PUT`/`PATCH`/`DELETE` under `/api`, so the real answer set is **208 mutating operations**, not 8 — and all 8 route-level mounts are `POST`s already inside it. This is the thirteenth issue in this repo wrong about its own cause, extent, or progress, and again in the direction of understating.

  **A gate can now name the methods it guards**, because one here genuinely is method-conditional. A read is never write-limited, so a method-blind derivation would have put a `429` on all 156 `GET`s and been wrong about every one. `expectedCodes` takes the method and skips a gate that does not run for it.

  **The method list has one home.** The branch moved out of an inline arrow in `app.ts` into `mutationRateLimit` in `rateLimiter.ts`, beside the limiter it guards and the `RATE_LIMITED_METHODS` its gate stamp carries. As an anonymous wrapper it was invisible to `readGate` — the limiter underneath could be stamped all day and the contract would never see it — and a second copy of the method list is the encoded-twice shape that let 309 of 364 `security` blocks drift.

  **`securityForGates` no longer treats every gate as a credential**, which the spec caught rather than review. A limiter refuses a caller whose credentials were fine, or who needed none, so stamping the site-wide one briefly put `cookieAuth` on `POST /auth/register` and five other public endpoints — the contract asserting a session requirement that does not exist. Verified after the fix: **0 of 364 `security` blocks changed**, and the whole contract diff is the 205 added `429`s.

  **One mutation is genuinely unlimited, and the contract correctly stays silent about it.** `POST /install/checklist/{id}/dismiss` sits under a router mounted **before** the site-wide limiter and carries none of its own, so nothing rate-limits it. Filed separately; a spec names it so the exception reads as a finding rather than an oversight.

  The two hand-written `429`s are deleted, since both read exactly what derivation produces. **No hand-written 429 remains in the registry**, and `openapi:failure-coverage` reads 215 / 0 / 149 before and after — the interaction #553 warned about, measured at zero.

- **The `/reports` surface declares the failures its handlers answer** ([#517](https://github.com/orphic-inc/stellar-api/issues/517)) — the first burn-down slice. `openapi:failure-coverage` moves from **215 documented / 0 verified silent / 149 unreviewed** to **222 / 2 / 140**. Purely additive: 21 response entries registered, no existing shape changed. **stellar-ui owes an `api:sync`.**

  **The issue's own worked example was wrong about three of its five rows, this time by overstating.** It records a `400` fallback on `claim`, `unclaim` and `resolve`, from the `?? 400` in each route's `statusMap`. Reading the module shows every reason those functions can return is already in its map — `claimReport` returns only `not_found`/`resolved`/`already_claimed`, and so on — so **each `?? 400` is unreachable**, and no `400` from that path is registered. The reachable `400`s come from `validate`/`validateQuery`/`validateParams`, which answer `ValidationError` rather than `MsgResponse`; the two are registered as the different shapes they are.

  **`GET /reports/{id}` was the blind-spot example and is now closed.** It declared a handler-thrown `403` and omitted the `404` beside it, which is exactly the case the gate cannot see: an operation declaring _some_ gate-independent 4xx counts as covered.

  **`GET /reports/counts` and `GET /reports/stats` are recorded as verified silent**, not deleted from the baseline. Both are staff-gated reads with no validation and handlers that cannot fail. Dropping them outright would leave them unclassified and fail the gate — the `noFailureModes` list exists precisely so "read it, answers nothing" is distinguishable from "not yet read".

  **Every code registered here has a test already asserting it** — `404`, `409`, `422` and both `400`s are in `src/reports.spec.ts` and `src/modules/reports.spec.ts` today. The contract was behind the suite, not ahead of it. Both ratchet directions were then verified by breaking them: re-adding a burned entry to `unreviewed` fails as stale, and claiming a documented operation is silent fails as a contradiction.

- **The site-wide IP-ban `403` is stated once, in `info.description`**, rather than on all 364 operations ([#517](https://github.com/orphic-inc/stellar-api/issues/517)) — `rejectBannedIps` runs **before routing**, so every endpoint can answer it and none owns it, including endpoints needing no session. Declaring it per-operation would be literally accurate and would drown the per-operation distinctions the derived `401`/`403` exist to draw, and OpenAPI has no top-level `responses` to say it in. This rides with the first burn-down slice, as planned.

- **The contract says the `{ msg }` response wrapper once instead of 356 times** ([#562](https://github.com/orphic-inc/stellar-api/issues/562)) — `msgResponse(description)` and a new `validationResponse` sibling replace the `content: { 'application/json': { schema: MsgResponse } }` block that 293 registrations spelled out longhand, plus 63 for `ValidationError`. `src/lib/openapi.ts` loses **1,009 lines**. No description changes, so `openapi.json` is **byte-identical** and stellar-ui owes nothing.

  **`openapi.json`'s absence from the diff is the proof, and CI cannot supply it.** The freshness gate asserts the committed document matches what the registry generates — so a mis-transcribed description, regenerated and committed alongside, leaves the two files agreeing and the gate green, with the contract changed under a commit claiming no behaviour change. That is the mutation a 356-site mechanical sweep is most likely to produce, so the file was never regenerated onto the branch. A unit test pins both helpers' emission, failing readably rather than as a 356-operation JSON diff.

  **The helpers keep a literal `$ref` and moved to the top of the file**, for two reasons that are not stylistic. `applyGateDerivations` splices into the **already-generated** document, where a Zod schema is emitted verbatim as garbage — the literal is the one form both it and the generator render identically, which is what lets one helper serve the hand-written blocks and the derived ones. And `const` does not hoist: below the 352 `registerPath` calls that run at module evaluation, the first call site throws `ReferenceError` on import of a file `app.ts` loads. `MsgResponse` and `ValidationError` lose their now-unreferenced `const` bindings, matching `ErrorResponse` beside them.

  **404s are still not derived** ([#517](https://github.com/orphic-inc/stellar-api/issues/517) measured and rejected that): 168 operations carry 50 distinct descriptions a generator could not invent, and the only plausible key fails both ways — 10 param'd paths provably never 404, 14 non-param'd ones do. This is the DRY win that was actually available, because it removes the boilerplate without touching a single description.

- **The `/bookmarks` surface declares the failures its handlers answer** ([#517](https://github.com/orphic-inc/stellar-api/issues/517)) — the second burn-down slice. `openapi:failure-coverage` moves from **222 documented / 2 verified silent / 140 unreviewed** to **230 / 7 / 127**. Purely additive: `openapi.json` gains 80 lines and loses none.

  **#517's own claim about this surface was wrong, in both directions, which is why the burn-down reads handlers instead of trusting the list.** It said twelve operations emitting no 4xx at all. There are **thirteen**, and **eight of them answer a 400**: every `post` and `delete` here runs `validateParams` with `z.coerce.number().int().positive()` on the path id, reachable with any non-numeric segment. `middleware/validate.ts` does not call `markGate` — only auth, permissions and the rate limiter do — so that 400 is gate-independent, which is precisely what this axis measures. The remaining five (the four segment lists, plus `DELETE /bookmarks/releases/consumed`) have no param to validate and do answer nothing; they become `noFailureModes`.

  **One edit moved eight operations**, because the three verbs per segment are generated by a `registerBookmark` factory rather than written out four times.

  **A 404 was deliberately NOT declared**, though it is the code a reader would expect. A `post` naming a well-formed but nonexistent id hits a foreign-key violation, which carries no `statusCode` and so surfaces as a **500** through `err.statusCode ?? 500` — filed as [#564](https://github.com/orphic-inc/stellar-api/issues/564). This axis records what a handler answers today, so declaring a 404 would have documented an intention. It becomes declarable when #564 is fixed.

- **The `/users` surface declares the failures its handlers answer** ([#517](https://github.com/orphic-inc/stellar-api/issues/517)) — the third burn-down slice, and the largest. `openapi:failure-coverage` moves from **230 documented / 7 verified silent / 127 unreviewed** to **243 / 10 / 111**. Purely additive: `openapi.json` gains 130 lines and loses none.

  **Thirteen of the sixteen answer a 400, all from the same source.** Seven run `validateQuery` over a pagination or filter schema and six run `validateParams` over the path id. As on `/bookmarks`, that code is gate-independent — `middleware/validate.ts` does not call `markGate` — so it is exactly what this axis exists to catch. Across two slices the validation 400 is now the dominant undeclared failure, which is worth knowing before the remaining 111.

  **The three that answer nothing genuinely answer nothing**: `GET /users/donor-ranks`, `GET /users/duplicate-ips` and `GET /users/me/snatch-list` take no parameter to validate, and `getDuplicateIps`/`getSnatchList` contain no throw.

  **No 404 is declared, and that is a finding rather than an omission.** Six of these read a user by path id, and none of them 404 for a user that does not exist: `getReputation` returns `{ score: 0, dimensions: [], suspect: false }` explicitly (`modules/reputation.ts:591`), and the warnings, notes, IP-history, email-history and snatch-list readers all return an empty list from a `findMany` that simply matches nothing. That is consistent behaviour rather than five separate oversights, so it is recorded as the contract instead of being "fixed" into a 404 by a later reader.

  **#517's per-surface tally is not reliable and should not be batch-applied.** It counts `/users` at 17 against an actual 16, having already claimed twelve no-4xx operations on `/bookmarks` where there are thirteen and eight answer a 400. Each slice re-derives its list from `openapi-failure-coverage-baseline.json` and reads the handlers.

- **The validation `400` is derived from the middleware that answers it** ([#567](https://github.com/orphic-inc/stellar-api/issues/567)) — the fourth gate-implied code, after the `401`/`403` ([#557](https://github.com/orphic-inc/stellar-api/issues/557)) and the `429` ([#559](https://github.com/orphic-inc/stellar-api/issues/559)). **299 of 364 contract routes run a validator and 196 of them declared nothing**; they now all do. `openapi.json` gains 196 response blocks and changes nothing else — no description edits, no security edits.

  **The rejection of derived 404s did not transfer, and had been applied here without being re-tested.** #517 rejected that on two findings, neither of which holds for this code. There **is** a mechanical authority: a 404 comes from a handler, scattered over 136 `res.status(404)` and 68 `AppError(404)` sites, while this 400 comes from three middleware factories sitting on the route stack where `collectRoutes` already reads gates. And there is **no information to destroy**: 168 operations declare a 404 across 50 distinct descriptions, where the validation 400s used 77 identical `Validation error` strings. Measured also: every validator carries a schema that can reject — no empty or passthrough schemas — and **every `400` in the contract sits on a validated route**, so there is no hand-written remainder.

  **The derived description is better than the strings it replaces**, which is the #557 argument repeating. `Gate` gains `targets`, so a validation gate says which part of the request it covers, and the contract distinguishes `Invalid path parameters` (108) from `Invalid request body` (19), `Invalid query parameters` (30) and the two combinations (39). `Validation error` never said whether to check the URL or the payload. It also cannot drift: a route that gains a `validateQuery` later has its description follow.

  **The body is `ValidationError`, not `MsgResponse`.** `validate.ts` sends `{ msg, errors }`, and stellar-ui generates 227 service types from this document — emitting `{ msg }` would have propagated a type asserting `errors` does not exist, across 196 operations at once. `responsesForGates` therefore picks a body per code instead of assuming one.

  **`securityForGates` filters `validation` alongside `rateLimit`**, and a test pins `POST /auth/register`. Without that filter every one of the 299 validated routes would assert a session requirement, which is precisely the bug [#553](https://github.com/orphic-inc/stellar-api/issues/553) fixed for the write limiter on that exact route — the same mistake was available here with a far wider blast radius.

  **`openapi:failure-coverage` moves to 187 / 31 / 146, and the drop is the correction.** A 400 stops counting as handler coverage the moment its gate implies it, so 56 operations whose only declared code was that 400 leave the axis: **21 to `noFailureModes`** — the `/bookmarks` and `/users` handlers read in full during #565/#566 — and **35 to `unreviewed`**, because nobody has read those. Recording all 56 as verified-silent would be the regeneration the baseline file forbids. The axis exists for failures middleware cannot explain, and it had been counting 56 that it could.

- **The contract stops restating the validation `400` the middleware already declares** ([#567](https://github.com/orphic-inc/stellar-api/issues/567)) — the second half of the derivation. **73 registrations deleted**, covering 79 operations (two of them sit in the `registerBookmark` factory, so one line each serves four segments). `openapi.json` shows **79 description changes and nothing else**: no response added, none removed, no body changed, no `security` touched, and the failure-coverage baseline untouched at **187 / 31 / 146**.

  **Every one of those 79 descriptions got more specific**, which is the point rather than a side effect: `Validation error` became `Invalid request body` (29), `Invalid path parameters or request body` (24), `Invalid path parameters` (17) and `Invalid query parameters` (9). The generic string never told a caller whether to check the URL or the payload; the derived one is read off the validators the route actually mounts, so it also cannot drift.

  **The 24 registrations that say something the middleware cannot are kept**, by the same REGISTERED WINS rule that protects `GET /asset/{hash}`'s bespoke 401. Five are `ValidationError`-bodied and carry real detail — `Invalid IP address, reversed bounds, or a range spanning both address families` — and 19 are `MsgResponse`-bodied 400s that are not validation failures at all, like `Invalid credentials` and `Cannot delete the default stylesheet`. Deleting those would have destroyed information, which is precisely why 404s are not derived.

  This completes #567. The failure-coverage axis now measures only what handlers answer, and the remaining burn-down no longer hand-writes a code the middleware declares for it.

- **The `/staff-inbox` surface declares the failures its handlers answer** ([#517](https://github.com/orphic-inc/stellar-api/issues/517)) — the fourth burn-down slice, and the first taken after the validation `400` became derived. `openapi:failure-coverage` moves from **187 documented / 31 verified silent / 146 unreviewed** to **191 / 39 / 134**. Purely additive: `openapi.json` gains 70 lines and loses none.

  **Only four of the twelve answer anything, and that ratio is the new normal.** `/bookmarks` and `/users` looked productive because thirteen of their twenty-nine operations answered a derivable `400`; now that [#568](https://github.com/orphic-inc/stellar-api/issues/568) declares it for all 299 validated routes, a slice sees only genuinely handler-thrown codes. Eight of these twelve therefore go to `noFailureModes` rather than gaining a registration.

  **The three ticket-state transitions share one shape: `404` for the ticket, `422` for the state.** `POST /staff-inbox/tickets/{id}/resolve` answers `already_resolved`, `/unresolve` answers `not_resolved`, and `/assign` answers `assignee_not_staff` — each a 422 beside a 404, decided by `result.reason` in the route. That `422`-for-state convention was already documented on `POST /staff-inbox/tickets/{id}/reply` (`Ticket resolved`); these three were answering it undeclared.

  **`resolve` masks a non-owner as `404`; `unresolve` has nothing to mask.** `resolveTicket` runs for any authenticated member and returns `not_found` when the caller is neither owner nor staff, so its description matches the reply route's — _"No such ticket, or it is not the caller's"_. `unresolveTicket` is behind `staff_inbox_manage` and reads no `userId`, so its `404` means only that no such ticket exists. The two are deliberately not worded alike.

  **`assign`'s `404` has three sources and one description.** The ticket may not exist, `assignedUsername` may name nobody (`{ msg: 'User not found' }`, raised in the route), or `assignedUserId` may name nobody (`assignee_not_found`, raised in the module). _"No such ticket, or no such assignee"_ covers all three; splitting them would need a code the route does not send.

  **The eight silent ones are reads and unconditional writes.** `GET /staff-inbox/queue`, `/queue/count`, `/responses`, `/tickets` and `/tickets/count` are a `count` or a `findMany` with no `throw` on any path. `POST /staff-inbox/bulk-resolve` never returns `ok: false` — ids matching nothing simply resolve zero tickets. `POST /staff-inbox/tickets` and `POST /staff-inbox/responses` are bare `create` calls whose only foreign key is the authenticated caller, and `StaffInboxResponse.name` carries no unique constraint, so neither can hit the `?? 500` unique-violation class filed as [#564](https://github.com/orphic-inc/stellar-api/issues/564).

  **The `404` on `PUT /staff-inbox/responses/{id}` still reads `Not found` and was left alone.** Its `DELETE` sibling, in scope here, declares the handler's actual `Response not found`. Rewording an operation already off this axis is out of a slice's scope, and the inconsistency is recorded rather than quietly fixed.

- **The `/forums` surface declares the failures its handlers answer** ([#517](https://github.com/orphic-inc/stellar-api/issues/517)) — the fifth burn-down slice. `openapi:failure-coverage` moves from **191 documented / 39 verified silent / 134 unreviewed** to **197 / 45 / 122**. Purely additive: `openapi.json` gains 111 lines and loses none.

  **Six of the twelve declare something, and five of those six answer the same pair.** `404 Forum not found` beside `403 Insufficient class to read this forum` is the forum-class read gate, and it is a _handler_ check rather than middleware: `modules/forumAccess.ts` throws both codes as `AppError`s, and `GET /forums/{forumId}/topics` and `GET /forums/{forumId}/topics/{topicId}/posts` call it. The other three open-code the same shape against their own floor — `POST /forums/{forumId}/topics` against `minClassCreate`, `POST /forums/last-read` against the post's forum, `POST /forums/polls` against topic authorship plus `forums_moderate`.

  **`GET /forums/categories` enforces a permission that no gate can express.** Its only middleware is `requireAuth`, so the contract derived a `401` and nothing else — but the handler answers `403` when `?all=true` arrives without `forums_manage`, `rank_permissions_manage` or `admin`. The permission is conditional on a query parameter, which is not something `requirePermission` can mount, so this `403` was invisible to every derived axis and is exactly what axis 7 exists to catch. It is the first conditional-permission `403` the burn-down has found.

  **The six silent ones split two ways.** `GET /forums`, `GET /forums/last-read` and `GET /forums/topic-notes/{topicId}` are a `findMany` with no `throw` on any path — the first filters by class in memory after the query rather than failing. The other three are bare `create` calls: `POST /forums`, `POST /forums/categories` and `POST /forums/topic-notes`.

  **Two of those creates are further instances of [#564](https://github.com/orphic-inc/stellar-api/issues/564), and one declared operation has a third.** `POST /forums` with a nonexistent `forumCategoryId` and `POST /forums/topic-notes` with a nonexistent `forumTopicId` both hit a foreign-key violation that carries no `statusCode` and surfaces as a **500**; `ForumPoll.forumTopicId` is `@unique`, so a second `POST /forums/polls` on a topic that already has a poll is the unique-constraint half of the same defect. `ForumCategory.name` carries no unique constraint, so `POST /forums/categories` genuinely cannot fail. #564 is now a five-surface pattern rather than a `/bookmarks` quirk.

  **`GET /forums/{forumId}/topics/{topicId}/posts` 404s for a missing forum but not a missing topic**, and that is recorded rather than corrected. The forum is checked by `assertForumReadAccess`; the topic is only a `where` clause, so a nonexistent `topicId` returns an empty page with `total: 0`. Declaring a topic `404` would have documented an intention.

- **The `/artists` surface is verified silent, all ten operations** ([#517](https://github.com/orphic-inc/stellar-api/issues/517)) — the sixth burn-down slice, and the first that registers nothing. `openapi:failure-coverage` moves from **197 documented / 45 verified silent / 122 unreviewed** to **197 / 55 / 112**. `openapi.json` does not change at all, so this is the one slice so far that costs stellar-ui nothing to re-vendor.

  **A whole-slice `noFailureModes` is the honest reading, not a shortcut.** An artist row is a shared catalogue entry with no ownership and no class floor, so every guard on the surface is either a permission gate — whose `403` is already derived — or nothing. `GET /artists`, `GET /artists/vanity-house`, `GET /artists/history/{artistId}`, `GET /artists/{id}/similar` and `GET /artists/{id}/subscribe` are a `findMany`, a `count` or a `findUnique` with no `throw` on any path, and `DELETE /artists/{id}/subscribe` is a `deleteMany` that no-ops. The four writes are a bare `create` or `upsert`.

  **An artist id that does not exist is a `404` on five operations and an empty `200` on four, on the same surface.** `GET`, `PUT` and `DELETE /artists/{id}`, `PUT /artists/{id}/vanity-house` and `POST /artists/{id}/subscribe` all read the artist first and 404; `GET /artists/{id}/similar`, `GET /artists/{id}/subscribe`, `DELETE /artists/{id}/subscribe` and `GET /artists/history/{artistId}` use the id only as a `where` clause and return `[]` or `{ subscribed: false }`. On `/users` the same split was consistent across the surface and was recorded as the contract; here it is not consistent, so it is recorded as a finding.

  **Three of the four writes are further [#564](https://github.com/orphic-inc/stellar-api/issues/564) instances.** `POST /artists/alias`, `POST /artists/similar` and `POST /artists/tag` take artist and tag ids in the body with no existence check, so a well-formed but nonexistent id is a foreign-key violation carrying no `statusCode` — a **500**. `POST /artists` is genuinely safe: `Artist.name` has no unique constraint and `createArtist`'s only foreign key is the authenticated editor.

- **The `/messages` surface declares the failures its handlers answer** ([#517](https://github.com/orphic-inc/stellar-api/issues/517)) — the seventh burn-down slice. `openapi:failure-coverage` moves from **197 documented / 55 verified silent / 112 unreviewed** to **201 / 61 / 102**. Five responses added, one description corrected, nothing removed.

  **`POST /messages` was declaring a `400` that meant the wrong thing.** Its registration read `Validation error` with a `MsgResponse` body — but the validation `400` on that route is derived from `validate(composeMessageSchema)` and carries `ValidationError`, while the handler's own `400` is `{ msg: 'self_message' }`. The registration was a correct _keep_ under [#569](https://github.com/orphic-inc/stellar-api/issues/569)'s REGISTERED WINS rule with an incorrect _description_, so the contract named the middleware's failure and described the handler's. It now says what the handler answers, and says plainly that a validation failure lands on the same code with an `errors` object the schema cannot show. **That collision is inherent to REGISTERED WINS** and already exists on `POST /auth` (`Invalid credentials`); this is the first slice to write it down rather than leave a caller to discover it.

  **`POST /messages` answers three handler codes off one `statusMap`.** `sendMessage` returns four discriminated reasons and the route maps them: `self_message` → 400, `recipient_not_found` → 404, and `recipient_disabled`/`recipient_pm_disabled` → 422. It is the `result.reason` pattern that produced every `/staff-inbox` registration, here spanning three codes instead of two.

  **`PATCH` and `DELETE /messages/{id}` mask a non-participant as `404`**, the same no-existence-leak rule `/staff-inbox` documents. Their `404`s are not identical, and the wording keeps them apart: `updateConversationFlags` also requires the conversation to still be in the caller's inbox or sentbox, so a conversation the caller has already deleted 404s on `PATCH` but not on a second `DELETE`.

  **`POST /messages/drafts` 404s from a module-thrown `AppError`**, not a route branch — `resolveDraftRecipient` throws `AppError(404, 'recipient_not_found')` when `toUsername` matches nobody. Worth noting that this lookup is case-**sensitive** (`findFirst({ where: { username } })`) while `POST /messages` resolves the same field with `mode: 'insensitive'`, so the two disagree about which usernames exist. Recorded, not changed — a slice documents behaviour.

  **The six silent ones are reads and unconditional writes.** `GET /messages`, `/sent`, `/unread-count` and `/drafts` are a `count` or a `findMany` with no `throw`; `POST /messages/bulk` is an `updateMany` that always returns `ok`; and `POST /messages/mass` treats `targetRankId` as a filter, so a nonexistent rank sends to nobody and answers `{ sentCount: 0 }` rather than failing.

- **`POST /auth/register` declares the `403` it has always answered** ([#517](https://github.com/orphic-inc/stellar-api/issues/517)) — the eighth burn-down slice, over `/auth`. `openapi:failure-coverage` moves from **201 documented / 61 verified silent / 102 unreviewed** to **202 / 68 / 94**. One response added, one description corrected, nothing removed.

  **This is #517's own worked example, closed.** The issue names `POST /auth/register` as the operation that "declares 200/400, answers 403 on three branches" and a spec pins it as _"the blind spot, pinned deliberately"_. There are **four** branches, not three — `registration_closed`, `invite_required`, `invalid_invite` and `invite_email_mismatch` — and the route is ungated, so this `403` is the site's registration policy refusing rather than middleware, which is exactly the origin this axis was built to catch. Its `400` was declared as `User already exists` and covers two further branches, `bad_password` and the email denylist; the description now says all three without naming the moderation mechanism, matching the deliberate vagueness of the message the handler sends.

  **Seven of the eight go to `noFailureModes`, and six for a reason no earlier slice met: their only handler failure is a code the middleware already implies.** `POST /auth/password`, `PUT /auth/email` and `POST /auth/recovery/reset` each throw `AppError(400, …)` for a real condition — a wrong current password, an email already in use, an expired recovery token — **and each already registers a `MsgResponse` 400 that names it**, kept by [#569](https://github.com/orphic-inc/stellar-api/issues/569). The contract is right; this axis simply cannot count it, because `gateIndependentCodes` subtracts every code a gate implies **regardless of who registered it**, and a validator gate implies 400. `GET /auth` is the same shape one code up: its only failure is a `401` for a user that vanished between the middleware's lookup and the handler's, identical to the one `requireAuth` already declares.

  **So a registered `400` on a validated route is invisible to this gate**, which is worth knowing before a future slice tries to move an operation by adding one. The remaining silent three are ordinary: `GET /auth/sessions` is a `findMany`, `POST /auth/logout` swallows an invalid token and always answers 204, and `POST /auth/recovery/request` always answers the same generic 200 — deliberately, so it cannot be used as an account-enumeration oracle, which its `description` already spells out.

  **`POST /auth/register` sends `201` and the contract says `200`** — found in the same read, recorded on [#575](https://github.com/orphic-inc/stellar-api/issues/575) rather than corrected here. The handler is right and the contract is wrong, so fixing it is a contract correction rather than an API change, but it removes a declared response instead of adding one and sits outside this axis.

- **The `/stats` surface is verified silent, all eight operations** ([#517](https://github.com/orphic-inc/stellar-api/issues/517)) — the ninth burn-down slice, and the second after `/artists` to register nothing. `openapi:failure-coverage` moves from **202 documented / 68 verified silent / 94 unreviewed** to **202 / 76 / 86**. `openapi.json` does not change at all.

  **It is a pure read surface.** Seven `GET`s are a `count`, a `groupBy` or a `findMany` with no `throw` on any path, and the one write — `POST /stats/snapshot` — is an idempotent `upsert` keyed on the hour bucket, so triggering it twice in an hour is a no-op rather than a conflict.

  **No route on the surface validates anything**, which is unusual enough to state: not one of the eight mounts `validate`, `validateQuery` or `validateParams`, so none carries even a derived `400`. The derived axes contribute only 401, 403 and 429 here, and this axis's answer is therefore the whole of what the contract can say about failure.

  **The one `AppError(403)` in the module belongs to a different surface, and grepping would have mis-attributed it.** `statsHistory.ts` throws `AppError(403, 'Stats are private')` — but from `getUserStatHistory`, which only a `/users` route calls. `GET /stats/history` calls `getSiteStatHistory`, a bare `findMany` with no throw. Reading the call graph rather than the file is what separates them.

  **`getSettings()` cannot fail on a missing settings row**, which is what `GET /stats` and `POST /stats/snapshot` would otherwise depend on: it is an `upsert` against `DEFAULTS` on `id: 1`, so it self-heals rather than throwing.

  **A data point for [#515](https://github.com/orphic-inc/stellar-api/issues/515):** `GET /stats/site-info` is the surface's only `requireAdminOnly()` mount, and it derives byte-identically to the five `requirePermission('admin')` siblings — same `401`, same `403 Missing admin`. From the contract's side the two helpers are already indistinguishable.

- **The `/announcements` surface is verified silent, all seven operations — and the read found four siblings declaring a `404` they cannot send** ([#517](https://github.com/orphic-inc/stellar-api/issues/517)) — the tenth burn-down slice, and the third to register nothing. `openapi:failure-coverage` moves from **202 documented / 76 verified silent / 86 unreviewed** to **202 / 83 / 79**. `openapi.json` does not change.

  **The seven in scope genuinely answer nothing.** Three `GET`s are a bare `findMany`. `POST /announcements` and `POST /announcements/global-notice` are a transaction of a `create`, a `findMany` and `emitNotifications`, which contains no `throw`; both write a foreign key that is the authenticated caller. `POST /announcements/blog` is the same shape without the transaction. `POST /announcements/album-of-month` is the surface's one create with no foreign key at all — `FeaturedAlbum.groupId` and `threadId` are plain `Int` columns with no relation — so unlike the [#564](https://github.com/orphic-inc/stellar-api/issues/564) cases on `/forums` and `/artists`, it cannot fail on a nonexistent id.

  **The finding is on four operations this slice did not touch. `PUT /announcements/{id}`, `DELETE /announcements/{id}`, `DELETE /announcements/blog/{id}` and `DELETE /announcements/global-notice/{id}` each declare a `404` and each is a bare `prisma.<model>.update`/`delete` with no existence check.** Prisma raises `P2025` for a missing row, the global handler in `app.ts` is `err.statusCode ?? 500` with no Prisma mapping, and `FieldError` is the only special case — so a nonexistent id answers **500**, and the declared `404` is unreachable. Their one correct sibling, `DELETE /announcements/album-of-month/{albumId}`, reads the row first and 404s properly. Four wrong, one right, one surface. Recorded on #564, whose root cause is identical.

  **This is the first time the burn-down has found the contract asserting a failure mode that does not exist**; every earlier finding was an omission. It also exposes a second blind spot in `openapi:failure-coverage` alongside the partially-described one already pinned: those four operations declare a gate-independent `404`, so the gate counts them as **documented** and has no way to know the code is unreachable. The `documented` total therefore includes at least four operations documented incorrectly.

- **`/communities`, `/search`, `/stylesheet` and `/top10` declare the failures their handlers answer** ([#517](https://github.com/orphic-inc/stellar-api/issues/517)) — the eleventh burn-down slice, and the first to take four surfaces at once now that each is down to five operations. `openapi:failure-coverage` moves from **202 documented / 83 verified silent / 79 unreviewed** to **206 / 99 / 59**. Purely additive: `openapi.json` gains 52 lines and loses none.

  **All four declarations are on `/communities`, and all four are community scoping.** `GET /communities/{communityId}/releases` reaches `assertCommunityAccess` through `listCommunityReleases` and answers its `404 Community not found` and `403 Not a member of this community`; `POST /communities/{communityId}/releases` answers the same `404` from `createCommunityRelease`; and both `/dnc` writes read their target first — a missing community on the `POST`, and on the `DELETE` an entry that is scoped to the community, so a valid `dncId` belonging to a different one is also a `404`.

  **The other three surfaces are silent for one architectural reason, and it is the most useful thing this slice found.** There are two ways to enforce the same access rule, and which one a surface picks decides whether it has failure modes at all. `/communities` **asserts** — `assertCommunityAccess` throws 404 then 403. `/search` **filters** — `communityReadableWhere` and `forumReadableWhere` travel into the query as `where` fragments, because a search spans every community and forum at once and has no single id to hand an assert. A search that filters cannot 403; it returns fewer rows. So all five `/search` operations answer nothing, and `search.ts` says so itself, pointing at `listCommunityReleases` as _"the same rule"_ enforced the other way. The two must stay in step, which is what `forumAccess.spec.ts` already pins.

  **`/top10` is silent because it is a cache in front of a read**, and `/stylesheet`'s three reads are a `findMany`. Its two writes do throw, but only codes the middleware already implies: `POST /stylesheet/author` answers 400 for a rank-quota overrun (`{ msg }`) and for a CSS boundary violation (`{ errors: { source } }`, one entry per violation), and `POST /stylesheet` answers 400 when `cssUrl` names a `/css` target that resolves to no authored stylesheet. As on `/auth`, a validator gate implies 400, so this axis cannot count any of them — **the conditions are recorded in each operation's `description` instead**, which costs no response entry and does not suppress the derived `ValidationError` body the CSS rejection actually uses.

- **`/friends`, `/profile`, `/subscriptions` and `/tools` are verified silent, all sixteen operations** ([#517](https://github.com/orphic-inc/stellar-api/issues/517)) — the twelfth burn-down slice, the second four-surface batch, and the largest to register nothing. `openapi:failure-coverage` moves from **206 documented / 99 verified silent / 59 unreviewed** to **206 / 115 / 43**. `openapi.json` does not change.

  **Every one of the sixteen is a list, a lookup that cannot miss, or a write against the caller's own row.** The nine reads are a `findMany`, a `count` or a `findUnique` that answers `{ subscribed: false }` rather than 404. `DELETE /profile` sets `disabled: true` on the authenticated user, whose existence `requireAuth` has already established. The four subscription writes are an `upsert` or a `deleteMany`. And `GET /tools/user-ranks/permissions` returns `PERMISSION_GROUPS`, a module constant — the one operation in the whole burn-down that touches no database at all.

  **`DELETE /friends/{userId}` no-ops where its sibling 404s, and the difference is `deleteMany` versus `updateMany`.** Removing a friendship that does not exist answers 204; `PUT /friends/{userId}/comment` runs the same `betweenUsers` filter through `updateMany`, checks `result.count === 0` and throws `AppError(404, 'Friend not found')`. Both are correct in isolation and the pair is inconsistent — the `/artists` split again, one file down. Recorded on [#575](https://github.com/orphic-inc/stellar-api/issues/575).

  **`Subscription.topicId` and `CommentSubscription.pageId` carry no foreign key**, and that is what makes these writes safe: subscribing to a topic that does not exist creates a dangling row rather than the 500 that [#564](https://github.com/orphic-inc/stellar-api/issues/564) records elsewhere. It is the mirror of that defect. Whether a bad id in a request body is a **500** or a **silently accepted dangling row** is decided entirely by whether the column is a real relation or a bare `Int` — the same distinction that made `POST /announcements/album-of-month` and `POST /forums/categories` safe. Neither outcome is a 4xx, so neither is visible to this axis.

  **The two subscription writes branch on `action` with `if`/`else if` and no `else`.** The Zod enum is exactly `['subscribe', 'unsubscribe']`, so the branch is exhaustive and no request can fall through unanswered — but that safety lives entirely in the schema, not in the handler.

- **The first half of the tail — twenty-two operations across nine surfaces** ([#517](https://github.com/orphic-inc/stellar-api/issues/517)) — the thirteenth burn-down slice. `openapi:failure-coverage` moves from **206 documented / 115 verified silent / 43 unreviewed** to **209 / 134 / 21**. One description corrected, five responses added, nothing removed.

  **`POST /contributions/{id}/access` is the richest operation the burn-down has found, and it declared none of it.** Granting download access debits the ratio ledger, so `grantDownloadAccess` answers **404** twice (no such contribution, no such consumer), **403** twice (consuming your own contribution, download access disabled), **409** once (a concurrent balance drain losing the compare-and-set), and **400** twice (no approved accounting size, insufficient contributed balance). The contract declared 200/400/401/429. The 403, 404 and 409 are now registered; the two 400 causes go in the operation `description`, since a validator gate already implies that code — and the description also records that a FREEPASS or NEUTRALPASS exemption skips the balance check, and that repeating the call inside the idempotency window returns the existing grant rather than charging twice.

  **`POST /install` declared its `409` as a `400`, and called it `Already installed or validation error`.** The handler answers **409** `Application already installed` and **400** `User already exists` — two different conditions the one description had merged, filed under the wrong code. This is the same species as the `Validation error` mislabel on `POST /messages` that [#574](https://github.com/orphic-inc/stellar-api/issues/574) fixed: a `MsgResponse` 400 whose description names something other than what the handler sends. **Two instances now, and neither was findable by any gate**, because a registered code suppresses the derived one and nothing compares the description to the source.

  **`PUT /contributions/{id}/ratio-exempt` answers a `404` from `setContributionRatioExempt`** and declared 200/400/401/403/429.

  **`POST /users/irc-nick/verify` reports failure in a `200` body.** `verifyIrcNick` returns `{ verified: false, reason }` for a nick with no pending claim, an expired code, or a nick another account won in the race — never a 4xx. That is a third answer-shape beside _assert_ and _filter_, and it is correct here: korin is the caller, and the reasons are operational rather than client errors. Recorded so the operation's place in `noFailureModes` is not read as "cannot fail".

  **Three more [#564](https://github.com/orphic-inc/stellar-api/issues/564) instances, all in this slice's silent set.** `POST /comments` writes six optional entity foreign keys; `POST /users` writes `userRankId`; and `DonorRank.name` is `@unique`, so `POST /users/donor-ranks` with a duplicate name is the unique-violation half. All three answer **500** for a well-formed request, so none is a 4xx and none is visible to this axis.

- **The #517 burn-down is complete — every one of the 364 contract operations has been read and classified** ([#517](https://github.com/orphic-inc/stellar-api/issues/517)) — the fourteenth and last slice, covering the remaining twenty-one. `openapi:failure-coverage` moves from **209 documented / 134 verified silent / 21 unreviewed** to **210 / 154 / 0**. Purely additive: `openapi.json` loses no line.

  **`POST /downloads/{grantId}/reverse` is the last undeclared operation, and it answers two codes.** `reverseDownloadAccess` throws `404 Grant not found` and `409 Grant is not in COMPLETED state` — the second being the guard against reversing a reversal, which credits the ledger back a second time. It declared 200/400/401/403/429.

  **Two of the twenty-one already described their handler 400s correctly, and both are [#569](https://github.com/orphic-inc/stellar-api/issues/569) keeps doing exactly what that rule intended.** `POST /asset` declares _"Empty, oversize, non-image, or misdeclared payload, or the rank asset limit is reached (or zero)"_, covering all four `assetStore` throws; `POST /ip-bans` declares a `ValidationError`-bodied 400 naming reversed bounds and cross-family ranges. Nothing to add — recorded because "already correct" is a result the burn-down should be able to report.

  **`unreviewed` is now empty and becomes a tripwire rather than a queue**, which the baseline's own `$comment` now says. A NEW route declaring no gate-independent 4xx lands in neither list, so the check fails as `unclassified` and its author has to read the handler and choose. The comment also records what `noFailureModes` does **not** claim: it means _"no gate-independent 4xx"_, not _"cannot fail"_ — an operation whose only failure is a validator-implied 400, one that reports failure in a 200 body, or one whose Prisma error surfaces as a 500 all belong there too.

  **What the burn-down cost and what it found.** Fourteen slices, 364 operations read; **43 responses added across 20 operations**, two response descriptions corrected, and `noFailureModes` grown from 31 to **154**. Along the way it filed [#573](https://github.com/orphic-inc/stellar-api/issues/573), widened [#564](https://github.com/orphic-inc/stellar-api/issues/564) from four operations to fifteen across eight surfaces, and opened [#575](https://github.com/orphic-inc/stellar-api/issues/575) as the register for everything recorded but deliberately not changed. **`210 / 364` is not a quality score** — at least four of those 210 declare a `404` their handler cannot send, which is #564's to fix, not this axis's to detect.

### Fixed

- **A gate's stamp could reach back into the authorization check it describes** ([#517](https://github.com/orphic-inc/stellar-api/issues/517)) — `requirePermission` passes the very array its closure evaluates on every request (`permissions.some((p) => hasPermission(perms, p))`), and `markGate` stored that reference as metadata. Anything holding the stamp could have mutated a live permission check.

  **Not exploitable** — every consumer is build-time and read-only, and `readonly string[]` blocks it at the type level — so it is defence in depth rather than a fix for a reachable bug. But `src/middleware/permissions.ts` is a documented high-risk file and metadata has no business aliasing enforcement state, so the stamp now stores a frozen copy. Found by the security review on [#555](https://github.com/orphic-inc/stellar-api/pull/555), which merged before the fix landed.

- **Five read endpoints served content with no session, and `/requests` ignored community membership** ([#547](https://github.com/orphic-inc/stellar-api/issues/547)) — found while enumerating the ungated routes for [#520](https://github.com/orphic-inc/stellar-api/issues/520): deriving `security` from the gates is only correct if "ungated" is _true_, so all 13 were read against their handlers. Five were gaps rather than intent.

  **`GET /requests` and `GET /requests/{id}` are the authorization defect.** Neither required a session, and `communityId` was a caller-supplied **filter, never a restriction** — while the projection carries the community's **name**. This is exactly what [#509](https://github.com/orphic-inc/stellar-api/issues/509) F2 fixed for `GET /search/requests`, left live on the browse path. #509's own writeup named the shape — _"the same rows were gated on one path and open on the other"_ — and this was the mirror image. Both now scope with `communityReadableWhere`, the same helper the search path uses.

  The list **filters** rather than refusing, for #509's reason: a 403 when the caller names a community would make `?communityId=N` an existence oracle. The detail read answers **404** rather than 403, so an unreachable request is indistinguishable from one that does not exist. It moved to `findFirst` because the scope is a relation filter, which `findUnique` cannot express.

  Unlike the release scope #509 built, there is **no `communityId: null` arm** here: `Request.communityId` is non-nullable, so there is no community-less set to preserve, and carrying the arm would be dead weight that reads as though it protected something.

  **`GET /comments` was the other half of #509 F4.** That fix gated `/comments/{id}` because a body "was readable with no session at all by guessing an integer id" — while the list beside it returned the same bodies, plus rendered `bodyHtml` and author refs, **paginated**. The detail route was gated and the bulk route was not, so no guessing was ever needed.

  **`GET /users/{id}` also served soft-deleted accounts.** "Public profile" described the projection, not the audience; it exposed member existence, registration date, donor status and profile text with no session. `disabled: false` was missing too, so a withdrawn account stayed readable by id, against the documented soft-delete convention.

  **`GET /announcements`** served site news and blog posts unauthenticated.

  **Gating all five cost nothing downstream** — stellar-ui's public surface calls `GET /install` and nothing else; announcements are consumed by `PrivateHomepage`. The same argument #509 used for the comment detail route.

  All five now declare the **401** they can answer: `openapi:auth-coverage` moved to **356 gated, 356 documented, 0 gaps**, and their `security` blocks appeared automatically from #520's derivation.

- **The contract defined no security schemes at all, and 309 of 364 operations disagreed with their own middleware** ([#520](https://github.com/orphic-inc/stellar-api/issues/520)) — `components.securitySchemes` was **absent entirely** while 112 operations referenced schemes by name, so every one of those references was dangling. The issue reported that as "109 operations declare `cookieAuth`"; measured, it was 70 `bearerAuth` and 42 `cookieAuth`, and the shape of the problem was different again.

  **The references were inverted.** `requireAuth` reads `req.cookies?.token` and has no `Authorization` path, yet **70 operations gated by it declared `bearerAuth`** — telling a client to send a header the API never reads. Meanwhile the only three routes that genuinely take a bearer token (`requireServiceKey`, korin's inbound calls under ADR-0013) declared **nothing**. The registry even carried a comment explaining why: declaring `bearerAuth` there "would describe the wrong credential". That reasoning was right; the fix was to name the scheme properly rather than to say nothing.

  **And 236 gated operations declared no `security` at all** — the largest bucket, and unmentioned by the issue. Only 42 of 364 were correct.

  **`security` is now derived from the middleware rather than declared.** `routeGate.ts` already stamps every gate as `auth | permission | service` for the [#494](https://github.com/orphic-inc/stellar-api/issues/494) coverage check, and that same stamp answers "with what credential?" — `service` → `serviceKey`, `auth`/`permission` → `cookieAuth`, ungated → nothing. All 103 hand-written blocks are deleted. The result is **351 operations carrying `security` and 13 not**, and 351 is exactly the count `openapi:auth-coverage` independently reports as gated.

  `auth` and `permission` collapse to one scheme deliberately: both present the same cookie, and the difference between them is 401 versus 403, which `responses` already carries. Encoding it twice in two vocabularies is how the two drift.

  **The route table is a required argument** to `buildOpenApiDocument`, so a document with underived `security` is unconstructible. That matters because `GET /api/docs/json` builds the spec live: an optional parameter would let the served document and the committed `openapi.json` disagree, and nothing compares that pair.

  **`bearerAuth` is renamed `serviceKey`.** It guards three machine-to-machine routes with a static shared secret, not a user token — a reader seeing `bearerAuth` could reasonably think a member's session JWT works there. The rename cost nothing: every existing reference to the old name was wrong and is deleted.

  The 13 operations left unsecured were each checked against their handlers rather than assumed — install, version, the five public auth endpoints, and five genuinely unauthenticated reads.

- **IP bans did nothing, and the schema could not have expressed them correctly anyway** ([#540](https://github.com/orphic-inc/stellar-api/issues/540)) — `IpBan` shipped with CRUD routes, an `ip_bans_manage` permission and OpenAPI registration, and nothing ever read the table. A moderator could ban a network, receive a 201, see it listed, and it did nothing. This is the second half of #540; the email blacklist was the first.

  **Enforcement could not land before [#542](https://github.com/orphic-inc/stellar-api/issues/542).** With `trust proxy` unset and the client IP read from a hand-parsed `X-Forwarded-For`, a ban would have been bypassable with one header — a control that _appears_ to work, which is worse than one that plainly does not.

  **The columns were wrong in three ways**, and fixing them was a precondition, not a tidy-up:

  1. `fromIp`/`toIp` were **signed** 32-bit `Int`s, so every address from `128.0.0.0` up stored negative. A range crossing that boundary — `100.0.0.0` to `200.0.0.0` — stored `from = 1677721600` and `to = -939524096`, and no `from <= c AND to >= c` can be satisfied by those. **The route's validator accepted such ranges**, so staff could create a ban that silently matched nothing.
  2. **IPv6 was unrepresentable**, while nginx listens on `[::]:80` — so IPv6 clients connected and could never be banned.
  3. `req.ip` yields the IPv4-mapped form (`::ffff:8.8.8.8`) on a dual-stack socket, which the IPv4-only parser rejected outright.

  Both bounds are now the full 128-bit address as **32 lowercase hex characters**, IPv4 mapped into `::ffff:0:0/96`. Fixed width is the point: lexicographic order equals numeric order, so range containment is correct in SQL for both families and an ordinary btree index serves it. Prisma's generated migration for the type change carried **no `USING` clause**, which would have cast each `Int` to its decimal string and quietly turned every existing ban into an unmatchable value; the conversion is explicit and recovers the unsigned value with `::bigint & 4294967295`.

  **The check runs before routing**, so a banned network is refused everywhere — including on routes needing no session, and including a caller already holding a valid cookie. It applies to everyone, staff included: an exemption would have to load the session first, defeating "refused before routing" and adding a bypass path, and a moderator who bans their own network can be readmitted from elsewhere, whereas a wrong exemption is a hole nobody sees. The list is cached for 60s and invalidated on every ban write, so a ban a moderator just typed bites immediately.

  **It fails open** — an unparseable address, or a database error during the check, allows the request. A ban that misses is recoverable; a site that refuses everyone is not.

- **Every client IP this API recorded was attacker-controlled, and all rate limiting shared one bucket site-wide** ([#542](https://github.com/orphic-inc/stellar-api/issues/542)) — `trust proxy` was never set, while three call sites read `X-Forwarded-For` by hand and took `.split(',')[0]`. nginx sets `X-Forwarded-For: $proxy_add_x_forwarded_for`, which **appends** the real peer to whatever the client sent, so the first entry is the client's own claim. A request carrying `X-Forwarded-For: 1.2.3.4` was recorded as coming from `1.2.3.4`. Not a misconfiguration risk — the shipped behaviour.

  **`User.lastIp`, `UserSession.ipAddress` and `UserEmailHistory.ipAddress` were all written from that value**, and `GET /users/duplicate-ips` — the staff tool for spotting ban evasion and multi-accounting — reads nothing else. Anyone evading a ban could ensure their accounts never shared a recorded IP, or make innocent accounts appear to.

  **The same unset flag broke rate limiting in the opposite direction.** `api` publishes no ports and is reachable only through nginx, so `req.ip` was nginx's container address on **every** request — and `express-rate-limit` keys on `req.ip` with no `keyGenerator` here. `authLimiter`, `writeLimiter` and `installLimiter` therefore shared **one bucket for the whole site**: no per-client brute-force protection at all, and one caller hammering `/api/auth` could exhaust the limit for every legitimate user.

  `createApp` now sets `trust proxy` from the new **`STELLAR_TRUST_PROXY_HOPS`** (default **1** — the shipped stellar-compose topology puts exactly one nginx in front, always), and all three hand-rolled reads become `req.ip`. Configurable because it describes deployment topology rather than code: a local `npm run dev` has no proxy and should set `0`. A malformed value falls back to `1` rather than crashing boot, and the fallback is deliberately the safe end — too few trusted hops degrades IP accuracy, too many trusts attacker input, which is the bug.

  **A test was pinning the vulnerability.** `install-auth.spec.ts` sent `x-forwarded-for: 203.0.113.10, 10.0.0.1` and asserted the recorded address was `203.0.113.10` — the spoofed entry. It now asserts `10.0.0.1`, the entry nginx appended, so the spoof being ignored is what the suite guards. The harness's mocked config also had to learn `trustProxyHops`: without it `app.set('trust proxy', undefined)` silently disabled the setting, which is how the harness stopped representing the real app.

  **Historical rows cannot be trusted and are not migrated** — the true values are unrecoverable. Duplicate-IP results predating this change should be treated as unreliable, not merely stale.

- **The email blacklist had a full admin surface and nothing ever read it, so staff bans did nothing** ([#540](https://github.com/orphic-inc/stellar-api/issues/540)) — `EmailBlacklist` shipped with CRUD routes, an `email_blacklist_manage` permission and OpenAPI registration, but outside those routes and the registry the Prisma accessor appeared **nowhere** in `src/`. A moderator could add an entry, receive a 201 and see it listed, and the address stayed free to register. This is the inverse of [#536](https://github.com/orphic-inc/stellar-api/issues/536) and worse in one respect: there the control failed silently with no affordance, here every signal said the ban was in force.

  **Enforced on both paths an address can enter by** — registration and email change. Guarding registration alone would have left a member free to register with a clean address and then move to a blacklisted one, which is the same half-fix shape the issue is about.

  **An entry matches as a full address or a bare domain**, which is what the admin route's own validation message ("Email or domain is required") has always promised. Matching is literal — `example.com` does not silently also ban `@mail.example.com`, because widening a ban past what the moderator typed is a decision rather than a default. The lookup is two exact matches via `IN`, both served by the existing `email` index, rather than a `LIKE` scan.

  **Existing rows were unmatchable and are migrated.** Nothing ever read the column, so nothing cared about its case or whitespace; enforcement compares a lowercased address. Without `LOWER(TRIM(...))` over the existing rows the fix would have worked for new entries and quietly failed for old ones — the exact failure being fixed, reintroduced by the fix.

  **The check is independent of the invite flow.** A blacklisted address holding a valid invite is precisely the case a moderator is trying to stop: someone banned returning through a friend.

  **Blacklisting gates entry only; it does not disable existing accounts.** Deliberate — a domain-wide entry would otherwise turn adding a list row into a mass account action from a form whose only guidance is "Email or domain is required". Disabling an account stays a separate, explicit staff action.

- **`POST /email-blacklist` could always answer 400 and the contract never said so** ([#517](https://github.com/orphic-inc/stellar-api/issues/517)) — `validate()` emits the `{ errors }` envelope, and the pre-existing `comment` rule alone guaranteed it was reachable. Registered here rather than left to the #517 sweep because the same change makes it substantially more reachable.

- **The password denylist was enforced on three auth paths and nothing ever wrote a row, so it never blocked anything** ([#536](https://github.com/orphic-inc/stellar-api/issues/536)) — `isPasswordBanned` is called at registration and on both password-change paths, but `prisma.badPassword` appeared exactly **once** in `src/`: that read. No route, no seed, no `bootstrap.ts` helper ever created a `BadPassword` row, so the table was empty in every deployment and the check returned `false` on every call. AGENTS.md filed the model under "Stub models (no routes implemented)", which is wrong in the direction that matters — reading `auth.ts` it looks like a working denylist, and the stub table is where you would go to learn otherwise.

  **A shipped list of 237 entries**, seeded by `seedBadPasswords` into `seedAll` alongside the Golden Rules and theme fixtures. Nothing shorter than six characters is included: `min(6)` is the floor on every creation path, so a shorter entry could never be submitted to match against, and a denylist padded with rows that cannot fire overstates its own coverage — which is the failure this fixes.

  **The comparison now folds case.** Both sides are lowercased, so `PASSWORD` and `PaSsWoRd` are caught. Previously the lookup was exact and case-sensitive, which would have let a capital letter walk straight past the entire list. Folding it in the query rather than with Prisma's `mode: 'insensitive'` keeps the lookup an exact match, which is what the `@unique` btree index on `password` can serve; `findFirst` becomes `findUnique` for the same reason.

  **The seed is guarded by a recorded fact, not a row count.** `SiteSettings.badPasswordsSeededAt` is stamped on the first run and makes every later run a no-op. Counting `bad_passwords` rows instead would be wrong the way ADR-0022 describes for install state: staff are free to delete seeded entries they disagree with, and a count-based guard would resurrect the whole list on the next container boot, silently undoing a moderation decision. `seedGoldenRules` records a second instance of the same trap.

  **The seed upserts the settings row rather than updating it.** No migration plants `site_settings` and it is otherwise created lazily, so on a fresh database `seedAll` is frequently its first writer — an update would throw, and a `findFirst` guard would return null and make the whole seed a silent no-op. That is the exact bug being fixed, so it must not be reintroduced by the fix; an integration test pins it.

  **Scope, stated plainly: this makes a dead control live, it does not make passwords strong.** `min(6)` remains the floor at registration against `min(8)` at password change, and 237 notorious passwords do not constrain the space of weak ones — `dragon7` still registers.

## [0.9.1] — 2026-09-06

### Added

- **Twelve member-facing surfaces close the last of [#494](https://github.com/orphic-inc/stellar-api/issues/494)'s baseline — 41 gaps to ZERO.** Thirty-nine operations across `/contributions`, `/posts`, `/search`, `/subscriptions`, `/friends`, `/notifications`, `/settings`, `/comments`, `/profile`, `/random`, `/downloads` and `/install`. **`347 contract routes gated, 347 fully documented, 0 gap(s) (0 baselined)`** — every auth failure the middleware chain can produce is now described, across twenty slices.

  **`POST /downloads/{grantId}/reverse` is the burn-down's second any-of gate.** It is `...requirePermission('staff', 'admin')`, and `middleware/permissions.ts` evaluates `permissions.some(...)`, so the keys are alternatives — registered as `Missing staff or admin`. Assuming one key would have told clients an `admin`-only caller gets a 403 they do not get, exactly as it would have on `…/history/{historyId}/revert` in #513.

  **`DELETE /notifications/{id}` answered a 403 nothing declared.** It is `requireAuth`-only and so invisible to the gate; the handler rejects a notification belonging to someone else. Registered as `Not the recipient`, matching the wording its already-correct sibling `POST /notifications/{id}/read` uses for the same test.

  **Four content-free descriptions were replaced with the condition they actually describe**, since the slice already had those operations open (the rule recorded in #522: a bare 403 satisfies the gate exactly as well as a useful one).

  | Operation                                 | Was              | Now                                                 |
  | ----------------------------------------- | ---------------- | --------------------------------------------------- |
  | `DELETE /posts/{id}`                      | `Not authorized` | `Not the post author`                               |
  | `DELETE /posts/{id}/comments/{commentId}` | `Not authorized` | `Not the comment author`                            |
  | `PUT /comments/{id}`                      | `Not authorized` | `Not the comment author`                            |
  | `DELETE /comments/{id}`                   | `Not authorized` | `Not the comment author and missing reports_manage` |

  The last is the one that was actively misleading: a `reports_manage` holder **can** delete someone else's comment, which `Not authorized` gave no hint of.

  **Purely additive apart from those four descriptions, blast radius proved per operation and per surface**: exactly thirty-nine operations changed, the set of prefixes touched **equals** the twelve claimed, per-surface counts match the baseline's own breakdown, `components` byte-identical, path count unmoved at 267, and the four edited responses keep byte-identical schemas.

  **What "zero" does and does not mean.** It means every failure the **middleware chain** can produce is documented — the guarantee #494's gate can actually enforce. It does **not** mean every 403 is described: a handler-thrown 403 stays invisible to that gate, which is why this burn-down kept finding them by reading (#511, #516, #518, #523, #525 and this slice). [#509](https://github.com/orphic-inc/stellar-api/issues/509) covers the routes whose gating is itself wrong, [#517](https://github.com/orphic-inc/stellar-api/issues/517) the non-auth codes nothing measures, and [#520](https://github.com/orphic-inc/stellar-api/issues/520) the `security` blocks — the other half of #494's own title, which its gate never read.

- **Five staff-tooling surfaces now document the 401 and 403 their middleware answers — the nineteenth slice off [#494](https://github.com/orphic-inc/stellar-api/issues/494)'s baseline and the first BATCHED one, 70 gaps to 41.** Fifteen operations across `/donations`, `/email-blacklist`, `/ip-bans`, `/ratio-policy` and `/site-history`. Fully-documented operations went 293 to 308.

  | Surface            | Ops | Key                      | Codes |
  | ------------------ | --: | ------------------------ | ----: |
  | `/site-history`    |   4 | `site_history_manage`    |     7 |
  | `/donations`       |   3 | `admin`                  |     6 |
  | `/email-blacklist` |   3 | `email_blacklist_manage` |     6 |
  | `/ip-bans`         |   3 | `ip_bans_manage`         |     6 |
  | `/ratio-policy`    |   2 | `ratio_policy_manage`    |     4 |

  **Batching changes the PR, not the method.** Each surface got its own permission-key derivation, its own handler read with the corrected pattern from #523, and its own run of the insertion script; they share only a branch and a changelog entry. **All five are single-key with no any-of**, and **none has a handler-level 403** — the only other failures are `404`s for a missing row and one `400` for a malformed IPv4.

  **The verification gains one assertion when a PR spans surfaces: the prefix SET, not one prefix.** A single-surface slice asserts every changed operation is under its prefix; a batch must assert the set of prefixes touched **equals** the set claimed, or an edit leaking into a sixth surface would pass a count-based check. It does: exactly fifteen operations changed, across exactly those five prefixes, and the per-surface code counts (7/6/6/6/4) match the baseline's own breakdown.

  **`/site-history` is the only mixed surface here** — `GET /` is `requireAuth` and took the `401` alone, while the three writes are permission-gated. The other four are staff-only end to end, so every one of their operations took both codes.

  Note `modules/donor.ts` throws three 403s that look adjacent to `/donations` and are **not** on it: `donations.ts` imports nothing from `donor.ts`, and those belong to the donor-perk surface. Attributing them here would have been the same error #522 avoided with `statsHistory.ts`.

- **`Top10` now documents the 401 and 403 its middleware answers — the eighteenth slice off [#494](https://github.com/orphic-inc/stellar-api/issues/494)'s baseline, 78 gaps to 70, and the last single-surface slice.** Six operations in one router file; four member reads took **401 only** and two staff routes needed both. Fully-documented operations went 287 to 293.

  **Two different keys on one small surface**, which is why the insertion was driven by an explicit `{"METHOD /path": "key"}` map rather than a single key: `GET /top10/history` is `...requirePermission('staff')` and `POST /top10/snapshot` is `...requirePermission('admin')`. The map form asserts that the keys given and the operations needing a 403 are **exactly equal in both directions**, so assuming one key for the surface would have failed loudly instead of quietly mislabelling the snapshot route as staff-accessible.

  **No handler-level 403 anywhere** — checked with the corrected pattern from #523. The router's only other failure is a `404` when no snapshot exists for a given date and type, and `modules/top10.ts` throws nothing at all.

  **Purely additive, blast radius proved per operation**: exactly six changed, all under `/top10`, none losing a response or changing a non-`responses` key, `components` byte-identical, path count unmoved at 267.

- **`TagAliases` now documents the 401 and 403 its middleware answers — the seventeenth slice off [#494](https://github.com/orphic-inc/stellar-api/issues/494)'s baseline, 86 gaps to 78.** Four operations in one router file, **every one taking both codes** under a uniform `tags_manage`. Fully-documented operations went 283 to 287.

  **The most uniform surface in the burn-down**: all four routes are `...requirePermission('tags_manage')`, single-key, and the whole surface is staff-only — there is no member-facing read here, which is why every operation needed both codes rather than the usual mix. Searched with the corrected pattern from #523: **no handler-level 403 anywhere**, only `404`s for a missing alias or a missing target tag.

  **Purely additive, blast radius proved per operation**: exactly four changed, all under `/tag-aliases`, none losing a response or changing a non-`responses` key, `components` byte-identical, path count unmoved at 267.

- **`Requests` now documents the 401 its middleware answers, plus a 403 nothing had declared — the sixteenth slice off [#494](https://github.com/orphic-inc/stellar-api/issues/494)'s baseline, 94 gaps to 86.** Eight operations in one router file. Fully-documented operations went 275 to 283.

  **This surface has no permission middleware at all** — every authorization is a handler or module decision, so #494's gate asked only for `401` on all eight. The real work was following the thin routes into `modules/requestLifecycle.ts`, where four functions throw 403 (`updateRequest`, `fillRequest`, `unfillRequest`, `deleteRequest`) and one more sits in the router itself.

  **`POST /requests` answers a 403 that nothing declared.** The handler checks `hasPermission(perms, 'requests_create')` inline and throws — registered now as `Missing requests_create`.

  **`DELETE /requests/{id}` had an incomplete description, and the shape is the one #516 found on `unclaim`: one code, two independent causes.** It said `Neither the owner nor a request moderator`, which is true of the first check — but `deleteRequest()` has a **second**, separate throw: a **filled** request can only be deleted by a request moderator, so the owner of a filled request is denied despite passing the first test. Now reads `Neither the owner nor a request moderator, or the request is filled and the caller is not a request moderator`. Description-only; the response schema is byte-identical.

  **The other three were already correct**, checked rather than assumed: `PUT /requests/{id}` (`Neither the owner nor a request moderator`), `POST /requests/{id}/unfill` (`Neither owner, filler, nor a request moderator`) and `POST /requests/{id}/fill` (`You can only fill a request with your own contribution`, an ownership test on the _contribution_ rather than the request).

  **Purely additive apart from that one correction**: exactly eight operations changed, all under `/requests`, none losing a response or changing a non-`responses` key, `components` byte-identical, path count unmoved at 267.

  Note that `GET /requests` and `GET /requests/{id}` are **ungated** and so were never in this baseline — they are [#509](https://github.com/orphic-inc/stellar-api/issues/509)'s territory, not this slice's.

- **`Rules` now documents the 401 and 403 its middleware answers — the fifteenth slice off [#494](https://github.com/orphic-inc/stellar-api/issues/494)'s baseline, 103 gaps to 94.** Six operations in one router file; three needed both codes under a uniform `rules_manage`, three took **401 only**. Fully-documented operations went 269 to 275.

  **The cleanest surface in the burn-down.** The three reads are `requireAuth` and the three writes are `...requirePermission('rules_manage')`, single-key throughout — no any-of, no second key, no per-route variation. Searched with the corrected pattern from #523 (`\.status(4\|\.status(5\|AppError(`, which catches the prettier-wrapped chains the old `res\.status(` missed): this router has **no handler-level 403 at all**, only `404`, `409` and one `400`. So `Missing rules_manage` is the whole story for every 403 here.

  **Purely additive, blast radius proved per operation**: exactly six changed, all under `/rules`, none losing a response or changing a non-`responses` key, `components` byte-identical, path count unmoved at 267.

  Left for [#517](https://github.com/orphic-inc/stellar-api/issues/517): the `409`s on create and update (duplicate slug, second main rules page) and the `400` on deleting the main rules page are all undeclared. Different axis; no gate measures it.

- **`Wiki` now documents the 401 its middleware answers, plus two 403s nothing had noticed — the fourteenth slice off [#494](https://github.com/orphic-inc/stellar-api/issues/494)'s baseline, 115 gaps to 103.** Twelve operations in one router file. Fully-documented operations went 257 to 269.

  **The two undeclared 403s were found by fixing the grep, not by reading harder.** `POST /wiki/{id}/aliases` and `DELETE /wiki/{id}/aliases/{alias}` are `requireAuth`-only — invisible to #494's gate — and both call `canEdit()`, answering `403 Insufficient permission to edit this page`. Neither declared it. **The documented search pattern is what hid them:** `grep "res\.status(4"` matches only a single-line chain, and this file writes nine of its ten 403s as `return res` on one line and `.status(403)` on the next. On `/wiki` that pattern finds **1 of 10 sites**. Searching for `\.status(403)` instead finds all ten.

  **`/messages` and `/stats` were re-checked with the corrected pattern and neither had missed anything** — `/messages` has exactly the one 403 it already declared, `/stats` and `/bookmarks` have none. The narrow pattern happened not to bite on those surfaces; it would have bitten here.

  **Everything else on this surface was already correct**, which is what api#486 and #487 bought during the [ui#277](https://github.com/orphic-inc/stellar-ui/issues/277) migration. Eight of the ten remaining 403s were declared with accurate, specific descriptions, including the split that the migration originally got wrong: a **direct page read** answers `403 Insufficient rank to view this page`, while a **history read** answers `404` for the same `canRead` failure — deliberate non-confirmation — and reserves its `403` for the separate `canEdit` check. `DELETE /wiki/{id}` is an any-of gate and already says `Missing wiki_manage/admin`, naming both keys.

  **Purely additive, blast radius proved per operation**: exactly twelve changed, all under `/wiki`, none losing a response or changing a non-`responses` key, `components` byte-identical, path count unmoved at 267.

- **`Stats` now documents the 401 and 403 its middleware answers — the thirteenth slice off [#494](https://github.com/orphic-inc/stellar-api/issues/494)'s baseline, 128 gaps to 115.** Eight operations in one router file; five needed both codes, three took **401 only**. Fully-documented operations went 249 to 257.

  **All five 403s are `Missing admin` despite coming from two different gates** — four routes use `requirePermission('admin')` and `GET /stats/site-info` uses `requireAdminOnly()`. Per [#515](https://github.com/orphic-inc/stellar-api/issues/515) those are the same test: `hasPermission()` short-circuits on `permissions.admin` before consulting the requested key, so both deny exactly when `perms.admin` is falsy and neither admits staff. One description is correct for both.

  **A content-free description was replaced with the real condition.** `POST /stats/snapshot` already declared a 403 — so the gate never flagged it — but the description was the single word `Forbidden`, which tells a client nothing about how to avoid it. It is `requirePermission('admin')`, so it now says `Missing admin` like its five neighbours. Description-only; the response schema is byte-identical. **There are more of these** — `Not authorized` × 8 and `Forbidden` × 4 across the contract — and a bare 403 satisfies #494's gate exactly as well as a useful one does.

  **The `403` in `statsHistory.ts` belongs to a different route, and attributing it here would have been wrong.** `AppError(403, 'Stats are private')` sits in `getUserStatHistory()`, which serves `/users/{id}/stats/history`; `GET /stats/history` calls `getSiteStatHistory()`, which contains no throw at all. A module-level grep for `403` cannot tell those apart — only reading which function the route calls can.

  **Purely additive apart from that one correction, blast radius proved per operation**: exactly eight changed, all under `/stats`, none losing a response or changing a non-`responses` key, `components` byte-identical, path count unmoved at 267.

- **`Messages` now documents the 401 its middleware answers — the twelfth slice off [#494](https://github.com/orphic-inc/stellar-api/issues/494)'s baseline, 141 gaps to 128.** Thirteen operations in one router file, **401 only**. Fully-documented operations went 236 to 249.

  **Both 403s this surface can answer were already documented, and both are correct.** `POST /messages/mass` is the only permission-gated route here (`messages_mass_pm`) and already declared `Missing messages_mass_pm`. `POST /messages/{id}/reply` is `requireAuth`-only — invisible to the gate — and already declared `Not a participant`, which `replyToConversation()` confirms: its **only** failure is `not_participant`, returned when the caller has no participant row on that conversation. So the slice adds no 403 and corrects none, the third surface in a row to come back clean on the axis the gate cannot see.

  **Purely additive, blast radius proved per operation**: exactly thirteen changed, all under `/messages`, each gaining only its `401`, none losing a response or changing a non-`responses` key, `components` byte-identical, path count unmoved at 267. Three registrations used the one-line `responses` form (`POST /bulk`, `PATCH /{id}`, `DELETE /{id}`) and were expanded in the separate first pass.

- **`Bookmarks` now documents the 401 its middleware answers — the eleventh slice off [#494](https://github.com/orphic-inc/stellar-api/issues/494)'s baseline, 154 gaps to 141.** Thirteen operations, **401 only — the first surface in the burn-down with no 403 anywhere**. Fully-documented operations went 223 to 236.

  **The surface really is that simple, and it was verified rather than assumed.** All thirteen routes are `requireAuth` with no permission middleware, no `loadPermissions`/`hasPermission` call in any handler, and no `res.status(4xx)` or `AppError` anywhere in the router. The one module they delegate to — `removeConsumedReleaseBookmarks()` — cannot throw an HTTP error either. So `401` is the complete set of failures, not just the ones the gate can see.

  **It also needed a different edit, because twelve of the thirteen operations come from ONE source block.** `registerBookmark(segment, paramName, item)` is called four times (`artists`, `releases`, `communities`, `requests`) and registers three operations each. The insertion script used for every slice since #506 matches one registration block per operation, so it **refused to run** — its "baseline names operations with no registration" assertion fired, naming all twelve, instead of silently doing nothing. The fix was four hand edits: three inside the helper, one on the standalone `DELETE /bookmarks/releases/consumed`.

  **The risk that creates is leakage**, and it is what the per-operation diff is for: an edit inside a shared helper could touch operations the slice never intended. Exactly thirteen operations changed, **all under `/bookmarks`**, each gaining only its `401`, `components` byte-identical, path count unmoved at 267.

  This also confirms the honest caveat recorded on [#517](https://github.com/orphic-inc/stellar-api/issues/517): the twelve `/bookmarks` operations that declare no non-auth `4xx` are **correctly** silent, not omissions. That surface was the reason for stating the 47 param-bearing candidates there as candidates rather than as a defect list.

- **`Collages` now documents the 401 and 403 its middleware answers — the tenth slice off [#494](https://github.com/orphic-inc/stellar-api/issues/494)'s baseline, 169 gaps to 154.** Thirteen operations in one router file. Eleven took **401 only**; two needed both, under `collages_moderate`. Fully-documented operations went 210 to 223.

  **This is the most handler-authorized surface the burn-down has met, and it was already documented.** Seven `requireAuth`-only operations perform their authorization inside the handler — `#494`'s gate is structurally blind to every one of them — and all seven already declared a `403`. The reason is visible in the code: `loadActiveCollage()` deliberately does _not_ carry authorization with it, because the five routes sharing that load each gate differently afterwards, so each route states its own rule and the registry had followed suit.

  **Two of those seven descriptions were incomplete, found by verifying rather than assuming.** `PUT /collages/{id}` listed `isLocked`, `maxEntries` and `maxEntriesPerUser` as the staff-only fields but omitted a fourth: setting `name` on a **public** collage is staff-only too. `DELETE /collages/{id}/entries/{releaseId}` said the 403 meant "the entry is not the caller's", which implies only the member who added an entry may remove it — the handler also admits the **collage owner** and staff. Both corrected; both are description-only, with the response schema untouched.

  **`collage staff` is its own notion here and does not mean `collages_moderate`.** `hasCollageStaffPermission()` reads `perms['collages_moderate'] || perms['staff'] || perms['admin']` **directly**, bypassing `hasPermission()` — so the handler checks admit two keys the middleware gate on `/deleted` and `/{id}/recover` does not. Describing the handler 403s as `Missing collages_moderate` would have been wrong, which is why they say `collage staff`.

  **Purely additive apart from those two corrections, blast radius proved per operation**: exactly thirteen changed, all under `/collages`, none losing a response, no non-`responses` key touched, `components` byte-identical, path count unmoved at 267. The only pre-existing responses that changed are the two 403 descriptions, and their schemas are byte-identical before and after.

- **`Reports` now documents the 401 and 403 its middleware answers — the ninth slice off [#494](https://github.com/orphic-inc/stellar-api/issues/494)'s baseline, 186 gaps to 169.** Ten operations in one router file, under a single uniform key (`reports_manage`). Fully-documented operations went 200 to 210.

  **Two of the eight 403s are NOT what the middleware would have said**, and both came from reading handlers rather than from the gate. `GET /reports/{id}` is `requireAuth`-only — invisible to #494's gate — and answers a real `403`: `getReport()` admits the **reporter of that report** or a `reports_manage` holder, so it is registered as `Not the reporter and missing reports_manage`. A flat `Missing reports_manage` would tell a client the endpoint is staff-only when a member can read the report they filed.

  **`POST /reports/{id}/unclaim` has TWO independent causes for one code**, which is new in this burn-down. It is permission-gated, so the middleware contributes `Missing reports_manage` — but `unclaimReport()` _also_ answers 403 when the report is **claimed by another staff member**, since holding the permission does not let you release someone else's claim. Registered as `Missing reports_manage, or the report is claimed by another staff member`: the middleware description alone would have implied a `reports_manage` holder never sees a 403 here, which is false.

  **Purely additive, blast radius proved per operation**: exactly ten changed, all under `/reports`, none losing a response or changing a non-`responses` key, `components` byte-identical, path count unmoved at 267. Three registrations used the one-line `responses` form (`claim`, `unclaim`, `resolve`) and were expanded in the separate first pass; Prettier reports the result unchanged.

  **This surface is under-described on codes #494 cannot see, and this slice does not close that.** Every `/reports/{id}` route sends a `404` none of them declare; `claim`/`unclaim`/`resolve` map module reasons onto `422`, `409` and a `400` fallback, also undeclared. That is a **different axis** from auth coverage — no gate measures it — and it is left alone deliberately rather than folded in, so the per-operation "gained only its auth codes" check stays the evidence it is meant to be.

- **`Stylesheets` now documents the 401 and 403 its middleware answers — the eighth slice off [#494](https://github.com/orphic-inc/stellar-api/issues/494)'s baseline, 203 gaps to 186.** Thirteen operations in one router file. Nine took **401 only**; four needed both, under a single key. Fully-documented operations went 187 to 200.

  **The four are the first `requireStrictAdmin()` gates the burn-down has met**, and the key that describes them needed reading rather than assuming. Its own comment says it "admits only users with the literal `admin` permission" where `requirePermission('admin')` "treats staff ≡ admin" — but `hasPermission()` short-circuits on `permissions.admin` before consulting the requested key, so for the key `admin` the two collapse to the same test and neither admits staff. Both deny exactly when `perms.admin` is falsy, which is what makes `Missing admin` the honest description here. **The stale comment is left alone** — this slice is additive to the contract and changes no gating.

  **The handler-403 population on this surface was already documented, and this is the first surface where that is true.** `PUT` and `DELETE /stylesheet/author-stylesheet/{id}` are `requireAuth`-only, so #494's gate is structurally blind to them, and both already declare `403 Not your stylesheet` — verified against the real throw sites in `modules/authorStylesheet.ts` (the author check on update and on withdraw) rather than taken on trust, since a declared 403 can be wrong in the other direction. Nothing else on the surface can answer 403: the registry quota is a **400**, and adopting a withdrawn sheet is a **404**.

  **Purely additive, blast radius proved per operation**: exactly thirteen changed, all under `/stylesheet`, none losing a response or changing a non-`responses` key, `components` byte-identical, path count unmoved at 267. No registration used the one-line `responses` form, so no expansion pass was needed.

- **A shrink-only gate on whether the contract documents the auth failures its middleware can answer** ([#494](https://github.com/orphic-inc/stellar-api/issues/494)) — the sixth guarded axis, and the last description in this contract with an obvious mechanical authority that nothing read. [#474](https://github.com/orphic-inc/stellar-api/issues/474) proved every route is **registered**; it never claimed a registration was **complete**, and auth was the largest gap left: of 361 operations only **39 documented a 401** and **88 a 403**, and the three axes (401, 403, `security`) did not correlate — drift, not policy. `Tools` was the sharpest case, 16 `requirePermission` calls across the file and zero documented 403s, so a generated client saw an admin-only CRUD surface with no authorization failure to handle.

  **The authority is the middleware chain, so the middleware now labels itself.** `lib/routeGate.ts` stamps a non-enumerable symbol on each gate and `collectRoutes()` reads it back off the built app — the same "walk the real thing rather than re-implement its rules" choice `expressRoutes.ts` already made for #474. **It could not be done by inspection**: `requirePermission()` returns an array of _anonymous_ arrow functions, so there is no `fn.name` to match, and name-matching would break silently the first time one was renamed or wrapped. A handler with no stamp is reported as unknown, never guessed at.

  **A permission gate implies 401 _and_ 403, which is the rule that makes this worth having.** `requirePermission()` literally spreads `[requireAuth, check]`: an anonymous caller gets 401 from the first element, an authenticated one without the permission gets 403 from the second. A registration declaring only 403 describes half the gate. The measured backlog is **404 gaps across 347 gated operations** — 308 missing 401s and 96 missing 403s — grandfathered in `openapi-auth-coverage-baseline.json` and burned down slice by slice, exactly as `openapi-completeness-baseline.json` was taken from 91 to 0.

  **Verified to fail in both directions against the real app**, because a ratchet tested only on its happy path is indistinguishable from one that always passes: removing a baseline entry reports it as a new gap, and adding one for a route that does not exist reports it as stale. Gate detection was validated the same way — it classifies exactly 14 routes as public (install, version, login/register/logout/recovery, and the public reads) and exactly the 3 korin service-key routes (ADR-0013/0015), which is what the code says they are.

  **`security` blocks are deliberately out of scope.** They are inconsistent in a _different_ pattern from the response codes — `Bookmarks` carries `security` on 13 of 13 operations and documents zero 401s and zero 403s — so folding them in would be two rules wearing one hat. #494's own recommendation, followed.

- **The `Tools` surface now documents the 401 and 403 its middleware answers — the first slice off [#494](https://github.com/orphic-inc/stellar-api/issues/494)'s baseline, 404 gaps to 374.** All fifteen operations under `/tools/*` sit behind `...requirePermission(...)` — eleven on `rank_permissions_manage`, four on `staff_groups_manage` — and not one of them declared either failure, so a generated client saw an admin-only CRUD surface with no authentication or authorization response to handle. Each now declares both, against `MsgResponse`: the middleware answers `{ msg }` at both codes (`auth.ts` at 401, `permissions.ts`'s `{ msg: 'Permission denied' }` at 403), which was read off the middleware rather than assumed from the envelope convention.

  **Purely additive, and the blast radius was proved rather than asserted.** The emitted spec was diffed **per operation**: exactly those fifteen changed, each gaining `401` and `403` and losing nothing, `components` byte-identical and the path count unmoved at 267 — so stellar-ui's vendored spec sees fifteen new responses and no altered shape. The registrations were edited **by line number**, not by string replacement, because `responses` blocks are textually near-identical across components that must not change.

  **The thirty baseline lines were deleted because the ratchet forces it, not as bookkeeping.** Re-running the gate against the untrimmed baseline reports exactly those thirty as stale and fails — which is the shrink-only property doing its job in the direction that is easy to take on trust, and it was checked rather than assumed. `374 gap(s) (374 baselined)`, `39` fully-documented operations to `54`.

- **`StaffInbox` now documents the 401 and 403 its middleware answers — the second slice off [#494](https://github.com/orphic-inc/stellar-api/issues/494)'s baseline, 374 gaps to 350.** Unlike the `Tools` slice this surface is **not uniform**, and that is the point of it: nine of the fifteen operations are `...requirePermission('staff_inbox_manage')` and take **both** codes, while six are `requireAuth` alone and take **401 only**. The nine are the canned-response CRUD, the staff queue and its count, `bulk-resolve`, `unresolve` and `assign`; the six are the member-facing ticket reads and writes.

  **The six member-facing routes cannot answer 403 at all, and that was verified rather than assumed from their staff/member branching.** `GET /tickets/{id}`, `POST /tickets/{id}/reply` and `POST /tickets/{id}/resolve` each call `hasPermission(..., 'staff_inbox_manage')` inside the handler and pass an `isStaff` flag down, so they look like routes that ought to have an authorization failure. They do not: `modules/staffInbox.ts` **masks non-owner access as `not_found`** and has no `forbidden` outcome anywhere, so the failures are 404 and 422. Registering a 403 on them would have described a response the server never sends.

  **Purely additive, and the blast radius was proved per operation**: exactly those fifteen changed — nine gaining `401` and `403`, six gaining `401` — none losing anything, `components` byte-identical and the path count unmoved at 267. Fully-documented operations went 54 to 69.

  **The codes were taken from the gate's own baseline rather than re-derived by hand.** The checker already reads the middleware off the built Express app via `lib/routeGate.ts`; re-deriving "which of these is permission-gated" by reading the router would have been a second, weaker authority for something already measured. As before, the ratchet was shown to force the twenty-four deletions — the untrimmed baseline exits non-zero with exactly those twenty-four reported stale.

- **`Announcements` now documents the 401 and 403 its middleware answers — the third slice off [#494](https://github.com/orphic-inc/stellar-api/issues/494)'s baseline, 350 gaps to 329.** All eleven gated operations are `...requirePermission('news_manage')`, so the surface is uniform like `Tools` rather than mixed like `StaffInbox`. Ten took both codes; `PUT /announcements/{id}` needed **401 only**, because it already declared a correct `403` — the one operation on this surface that was half-documented rather than undocumented. Fully-documented operations went 69 to 80.

  **`GET /announcements` is deliberately untouched, and it is the reason this slice is worth reading twice.** It carries **no auth middleware at all**, so it is not in the baseline and gains nothing here. That is correct behaviour for this gate — #494 asks whether a _gated_ route documents its failures, never whether a route _should_ be gated — but it means a green auth-coverage run says nothing about the eleven-plus routes that answer before any authentication. See the note filed against the ungated-route audit; this PR does not change any route's gating.

  **Purely additive, blast radius proved per operation**: exactly eleven changed — ten `+401 +403`, one `+401` — none losing anything, `components` byte-identical, path count unmoved at 267. The insertion script now takes the surface prefix and permission key as arguments and **filters by the baseline rather than the path prefix**, which is what keeps `GET /announcements` out of it: a prefix can cover registrations with no gap at all, and the baseline is the authority on which those are.

- **`Artists` now documents the 401 and 403 its middleware answers — the fourth slice off [#494](https://github.com/orphic-inc/stellar-api/issues/494)'s baseline, 329 gaps to 310.** Thirteen of the sixteen operations are `requireAuth` alone and took **401 only**; three are permission-gated and took both. Fully-documented operations went 80 to 96.

  **This is the first surface using MORE THAN ONE permission key, and assuming otherwise would have mislabelled every 403 on it.** The three gated operations use three _different_ keys: `GET /artists/vanity-house` is `admin`, `PUT /artists/{id}/vanity-house` is `news_manage`, and `POST /artists/revert/{historyId}` is `communities_manage`. The insertion helper now takes either a single key or a `"METHOD /path" -> key` map, and when given a map it asserts the map and the set of operations needing a 403 are **exactly** equal in both directions — an unmapped operation and a mapped one that needs no 403 are both errors, so a stale map fails loudly instead of quietly writing the wrong permission name into the contract.

  **Purely additive, blast radius proved per operation**: exactly sixteen changed — thirteen `+401`, three `+401 +403` — none losing anything, `components` byte-identical, path count unmoved at 267. Each emitted `403` description was read back from the spec to confirm it names the right key, rather than trusting the map went in correctly.

- **`Users` now documents the 401 and 403 its middleware answers — the fifth and largest slice off [#494](https://github.com/orphic-inc/stellar-api/issues/494)'s baseline, 310 gaps to 271.** Thirty-three operations, and the shape differs from every earlier slice: **twenty-seven of them already declared a correct `403` and were missing only the `401`**. That is the signature of a surface written permission-first — the authorization failure was on everyone's mind, the authentication one was not. Six declared neither. Fully-documented operations went 96 to 129.

  **Six different permission keys across the six operations that needed a 403** — `users_edit`, `invites_manage` (twice), `ratio_policy_manage`, `login_watch_view` and `admin` — so the per-operation key map introduced for `/artists` was load-bearing rather than defensive. Each emitted description was read back out of the generated spec to confirm it names the right key.

  **Two operations answer a 403 that no middleware produces, and it was undocumented.** `GET /users/{id}/invite-tree` throws `AppError(403, 'Forbidden')` when the caller is neither the owner nor `invites_manage`, and `PUT /users/{id}/staff-bio` answers `res.status(403)` when the caller is neither `admin` nor the subject. **The auth-coverage gate cannot see either** — it reads the middleware chain, and these checks live in the handler — so both would have stayed missing indefinitely while the gate reported the surface fully documented. They are registered here with descriptions that say _why_ the 403 happens (`Not the owner and missing invites_manage`) rather than the flat `Missing <key>` a middleware gate produces, because the condition is genuinely different: **owner-or-permission, not permission alone.**

  **The three `requireAuth`-only routes on this surface were each read for an ownership check, and all three are correctly authorized** — the two above plus `GET /users/{id}/stats/history`, whose already-declared 403 was confirmed real (`getUserStatHistory` throws `AppError(403, 'Stats are private')`). So the under-gating found on `/artists` does **not** extend here; an auth-only gate on a route touching another member's data is a prompt to read the handler, not a finding on its own.

  **Purely additive, blast radius proved per operation**: exactly thirty-three changed, all under `/users`, none losing anything, `components` byte-identical, path count unmoved at 267.

- **`Forums` now documents the 401 and 403 its middleware answers — the sixth slice off [#494](https://github.com/orphic-inc/stellar-api/issues/494)'s baseline, 271 gaps to 235.** Thirty operations across seven router files, and the middleware picture is simple: **twenty-four are `requireAuth` alone and took 401 only; six are `requirePermission('forums_manage')`** — a single key, despite the surface being the most fragmented in the codebase. Fully-documented operations went 129 to 159.

  **But this surface is where the gate's blind spot is widest, and the slice deliberately does not close it.** Forum access is governed by per-forum rank (`minClassRead`/`minClassWrite`), which is checked **inside handlers**, not by middleware — `src/routes/api/forum/` and `modules/topicSession.ts` hold roughly nineteen `403` sites between them. **Eighteen `requireAuth`-only forum operations still declare no 403 after this PR**, and the gate reports the whole surface fully documented regardless, because it derives expected codes from the middleware chain alone.

  **Those eighteen are candidates, NOT eighteen omissions**, and the two sampled prove both cases exist: `GET /forums` **filters** the list through `canAccessForumLevel()` and never answers 403, so declaring none is correct; `GET /forums/{id}` **does** answer `403 'Insufficient class to read this forum'` and omits it. **List filters, detail rejects** — the same asymmetry that made `GET /comments/{id}` serve soft-deleted rows while its list read does not. Separating them needs a handler read each, which is its own change rather than a rider on this one.

  **Purely additive, blast radius proved per operation**: exactly thirty changed, all under `/forums`, none losing anything, `components` byte-identical, path count unmoved at 267.

- **`Communities` now documents the 401 and 403 its middleware answers — the seventh slice off [#494](https://github.com/orphic-inc/stellar-api/issues/494)'s baseline, 235 gaps to 203.** Twenty-eight operations across four router files. Twenty-four took **401 only**; four needed both, using three keys — `dnc_manage` (twice), `communities_manage`, and one **any-of pair**. Fully-documented operations went 159 to 187.

  **`POST …/history/{historyId}/revert` is the first any-of gate in the contract**, and getting it right meant reading `requirePermission` rather than assuming. It is declared `...requirePermission('communities_manage', 'admin')`, and the middleware evaluates `permissions.some(...)` — so the two keys are **alternatives, not both required**. Registered as `Missing communities_manage or admin`; describing it as `Missing communities_manage` would have told clients an `admin`-only caller gets a 403 when they do not.

  **Purely additive, blast radius proved per operation**: exactly twenty-eight changed, all under `/communities`, none losing anything, `components` byte-identical, path count unmoved at 267. One registration used the one-line `responses` form and was expanded first; Prettier reports the result unchanged.

  **Eight `requireAuth`-only operations here still declare no 403, and this slice does not close that** — the same structural blind spot recorded for `/forums`. Community reads go through `assertCommunityAccess`, which throws `AppError(403, 'Not a member of this community')` from `modules/communityAccess.ts`, so several of the eight very likely do answer 403. As on `/forums`, they are **candidates needing a handler read each**, not eight known omissions: the neighbouring `GET …/releases/{releaseId}/contributions` and `…/history` already declare their 403s, which is what a correctly-documented one looks like.

- **The last eleven routes join the OpenAPI contract, and the [#474](https://github.com/orphic-inc/stellar-api/issues/474) backlog is closed — `361 routes served, 361 operations registered, 0 unregistered`** — user identity, rank and the staff forensics reads. Seven new components. **Eleven routes with seven different gates, which is the whole value of this slice**: three are `requireServiceKey` — korin.pink inbound, not member routes — and the other eight span `duplicate_ips_view`, `registration_log_view`, `users_view_email`, `users_view_ips`, `users_edit`, `staff`, and plain self-authentication. The three service-key routes are registered **without** a `bearerAuth` block, because describing them with the member credential would be describing the wrong one. **`GET /users/{id}/reputation` needed the most care: it returns the full, UNFILTERED reputation**, including the invite-tree Contagion signal and a _meaningful_ `suspect` flag, where the member-facing `GET /profile/me/reputation` strips the moderation dimensions and therefore always reports `suspect: false`. Identical JSON shape, very different exposure — and ADR-0004 §3 requires the suspicion signal be kept from members so a sockpuppet ring is not tipped off, so a contract that described the two alike would have invited a UI to bind to the wrong one. Whether CRS is member-facing at all remains open ([#429](https://github.com/orphic-inc/stellar-api/issues/429)); this documents what ships and settles nothing. Three further behaviours are recorded because the obvious guess is wrong: **`POST /users/irc-nick/verify` always answers 200** — a failed verification is a `{ verified: false, reason }` result the bot relays over IRC, not an HTTP error; **`GET /users/by-irc-nick/{nick}` answers 404 for a _disabled_ account exactly as for an unknown nick**, so it does not reveal that a suspended member exists; and **`PUT /users/{id}/rank` replaces the entire secondary-rank set**, which is precisely why rank-lock is a separate route rather than a field here.

**The completeness gate is now blocking with nothing grandfathered.** `openapi-completeness-baseline.json` holds an empty `unregistered` list, so any route added from here that is not registered fails CI on the first push — no flip was needed, because the ratchet was built to gate new routes from day one and only ever shrink. The twelve param-name mismatches remain baselined; they are cosmetic (the shapes match, only the placeholder names differ) and are the last known contract debt.

- **Donor ranks and grants join the OpenAPI contract — slice 9 of [#474](https://github.com/orphic-inc/stellar-api/issues/474)** — the donor-rank CRUD plus the per-user grant and revoke, taking the baseline **17 to 11**. One new component, `DonorRank`. **The permission split is uneven on purpose and the contract now says so:** `GET /users/donor-ranks` is the only donor route that needs no permission at all — any authenticated member may read the ladder, because the perks are member-facing — while all five writes require `donor_ranks_manage`. Three behaviours are documented because the obvious reading is wrong: **`PUT /users/donor-ranks/{rankId}` is a full replace, not a partial patch** — it validates against the same schema as create, so an optional field you omit is written as its default rather than left alone, which is how a client that treats it as PATCH silently blanks a rank's colour or badge; **`DELETE /users/{id}/donor` removes every donor-rank grant on that user**, not just the most recent, and clears the `isDonor` flag; and **`POST /users/{id}/donor` answers 201 with a message rather than the granted row**, which is unusual for a 201 but is what ships. The grant description also notes that `donorExpiryJob` sweeps expired grants hourly and is condition-based, so a later staff re-grant survives the sweep.

- **User moderation joins the OpenAPI contract — slice 8 of [#474](https://github.com/orphic-inc/stellar-api/issues/474)** — warnings, staff notes and account enable/disable, taking the baseline **25 to 17**. Two new components, `UserWarning` and `UserModerationNote`. **The eight routes span three different permissions and the contract now says which is which**: `users_warn` for the warnings trio, `users_edit` for the notes trio, `users_disable` for enable/disable — so a moderator who can warn cannot necessarily read notes or disable an account, and describing them all as "staff" would have lost that. `POST /users/{id}/warn` is documented as a **reputation event, not a note**: besides creating the row it increments the user's `warnedTimes` and stamps `warned`, which is what the Standing tier (PRD-05/ADR-0004) reads. Both create routes wrap their result (`{ warning }`, `{ note }`) and return it **without** the `warnedBy`/`author` relation that the corresponding list routes include, so those are optional on the components. `disable`/`enable` answer **200 with a message rather than 204**, and disable is the soft delete — it sets `disabled: true` and audits, it does not remove the row.

- **The community and release write surface joins the OpenAPI contract — slice 6 of [#474](https://github.com/orphic-inc/stellar-api/issues/474)** — twelve operations, taking the baseline **42 to 30**. Community create/update/delete, the member and curator sub-resources, and release create/update/delete plus the vote pair. Every GET on these paths was already registered, so this is almost entirely **write-method gaps** — the paths looked covered while nothing the UI needs to _change_ was described. Only one new component was needed (`CommunityVoteState`); `Community`, `CommunityMember`, `CommunityCurator` and `Release` already existed. **`PUT /communities/{id}` is documented as gating on `communities_manage` alone**, which is the settled position rather than an oversight: a community leader or curator cannot configure their own community, so `announceVisibility` and everything else there is site-staff-only, and [ADR-0030 §5 was amended to match the code](https://github.com/orphic-inc/stellar-api/pull/469). Four behaviours are recorded as-is rather than tidied: **`DELETE /communities/{id}/members/{userId}` answers 409 when the target is the leader or a curator** — that role must be reassigned first, and the leader is tested before the curator because a leader is always also a curator, so the message names the role that actually blocks; **`POST /{id}/curators` answers 204 while `POST /{id}/members` answers 201**, an existing asymmetry that a registration slice documents rather than changes; **`DELETE .../vote` answers 200 with the new state, not 204**, because it clears a vote rather than deleting a resource and the caller needs the updated aggregate; and **`PUT .../releases/{releaseId}` accepts `tagIds` and then ignores it** — tags are managed through the `/tags` routes, so sending them there succeeds and changes nothing, the same silently-ignored-input shape found in the wiki create route.

- **The entire wiki router joins the OpenAPI contract — slice 5 of [#474](https://github.com/orphic-inc/stellar-api/issues/474)** — twelve operations, taking the baseline **54 to 42**. This router had **zero** registry presence: not one path and not one component, so every wiki surface was invisible to stellar-ui. Four new components: `WikiPage`, `WikiRevisionSummary`, `WikiRevisionContent` and `WikiCompare`. **The access model is the substance of this registration, and it is two-tier by design.** A page above the caller's `minReadLevel` answers **404, not 403** — deliberate non-confirmation, so an unreadable page is indistinguishable from one that does not exist. A page the caller may read but not edit answers **403 with a specific message**, and the edit level — not the read level — is what gates **revision history, revision content and comparison**: being able to read a page does not entitle you to its history. Deletion is stricter still, gated at the middleware on `wiki_manage`/`admin`, so a per-page edit level never confers it. Three further behaviours are documented because guessing them wrong would be invisible: **`POST /wiki` silently forces `minReadLevel` and `minEditLevel` to 0 unless the caller can manage the wiki** — a plain `wiki_edit` author cannot create a restricted page and the values they send are ignored rather than rejected; **`GET /wiki/{id}/revisions/{rev}` for the _current_ revision returns the live page shaped like a revision**, so its `createdAt` is the page's `updatedAt` rather than a revision row's own timestamp; and **rollback writes a new revision rather than rewinding**, so history is never discarded. Aliases are addressed by their slug, which is their primary key, and are normalised before lookup.

- **The whole collages surface joins the OpenAPI contract — slice 4 of [#474](https://github.com/orphic-inc/stellar-api/issues/474)** — twelve operations, taking the baseline **66 to 54**. Only `/collages/deleted` had been registered, so browse, create, detail, update, delete, recover, the entries CRUD, the subscribe and bookmark toggles and the staff subscriber list were all invisible to stellar-ui. Four new components: `Collage`, `CollageEntry`, `CollageDetail` and `CollageSubscriber`. **The detail response is not the model** — it carries `descriptionHtml` (the [#402](https://github.com/orphic-inc/stellar-api/issues/402) render-at-read seam), `entries[]` whose releases have their stored `credits` array replaced by a derived `artist` field, and `isSubscribed`/`isBookmarked` describing the **caller**, which makes that response per-viewer and not cacheable across members. Several behaviours are documented because reading the handler contradicted the obvious guess: **`DELETE /collages/{id}` is not uniformly a soft delete** — a personal collage (categoryId 0) is **hard** deleted by its owner and cannot be recovered, while a public one is soft-deleted and staff-only, so an owner who may delete their personal collage gets a 403 on a public one; **`subscribe` and `bookmark` are toggles** despite their names, returning the state you ended in; **entry-limit rejections are 400, not 403** (the 403s there are the lock and the personal-collage owner rule); **`PUT /collages/{id}/entries` has no lock check at all**, only owner-or-staff; and `GET /collages/{id}` answers **404 rather than 403 for a deleted collage** seen by a non-staff member, so the endpoint does not confirm it exists.

- **CI now checks that the OpenAPI registry is _complete_, not just fresh** ([#474](https://github.com/orphic-inc/stellar-api/issues/474)) — `src/lib/openapi.ts` is a **manual** registry, and the existing gate only proves `openapi.json` matches it. Nothing proved the registry matches the routes that actually exist, so a route could ship unregistered, stay invisible to `openapi.json`, and be unconsumable by stellar-ui's generated types. [#198](https://github.com/orphic-inc/stellar-api/issues/198) treated one instance as a one-off; an audit found **91 unregistered operations across 16 route files** — the whole `wiki.ts` router, essentially all of `collages.ts`, and 25 in `user.ts`. Same failure shape as [#386](https://github.com/orphic-inc/stellar-api/issues/386) and stellar-ui [#271](https://github.com/orphic-inc/stellar-ui/issues/271): a manual surface with nothing comparing it to anything drifts, and the drift is silent in both directions. The new `npm run openapi:completeness` reads the route table **off the built Express app** rather than parsing `router.get(...)` out of the source — a static parse is a second implementation of Express's own mounting rules and has to re-derive nested `router.use()` prefixes to stay correct, whereas walking the built app cannot disagree with it. That costs a dependency on Express 4 internals, deliberately confined to `src/lib/expressRoutes.ts` and pinned by unit tests, so an Express upgrade fails a named test instead of silently reporting zero routes and passing forever. **The 91 are grandfathered in `openapi-completeness-baseline.json`, and that list is a ratchet rather than a mute button:** a new unregistered route fails immediately, so new routes are gated from day one without waiting for the backlog; a baseline entry that has since been registered fails as stale; and so does one whose route no longer exists. The list can therefore only shrink. Baseline matching is by operation shape, so renaming `:id` to `:userId` does not un-suppress a grandfathered gap. Param-name mismatches between the code and the registry (12 of them) are reported as warnings and never fail — they are harmless for path matching and only affect what the generated types call the param.

- **The request lifecycle joins the OpenAPI contract — slice 7 of [#474](https://github.com/orphic-inc/stellar-api/issues/474)** — `PUT` and `DELETE /requests/{id}`, `POST /requests/{id}/vote`, `POST /requests/{id}/unfill` and `GET /requests/{id}/bounty-history`, taking the baseline **30 to 25**. Three new components: `Request`, `RequestBountyEntry` and `RequestActionEntry`. **This router is the one place in the registry that answers `422`**, and it does so for _state_ violations — "Only open requests can be edited", "Request is not filled" — as distinct from the `400` it uses for validation failures. That distinction is documented rather than normalised away, because a UI that treats them alike cannot tell "your input was malformed" from "the request has moved on". `POST /requests/{id}/vote` is a **toggle** that takes no body, and `RequestBountyEntry.amount` is a BigInt column that serialises as a **string**.

- **Nine more routes join the OpenAPI contract — slice 3 of [#474](https://github.com/orphic-inc/stellar-api/issues/474): the PM drafts surface, plus four method gaps** — the whole drafts CRUD (`GET`/`POST` `/messages/drafts`, `PUT`/`DELETE` `/messages/drafts/{id}`) and `POST /messages/mass`, together with `GET /comments/{id}`, `PUT /announcements/{id}`, `GET /forums/categories/{id}` and `POST /forums/{id}/catchup`. Baseline **75 to 66**. The last four are method gaps on paths that were already registered under other verbs, which is its own kind of invisible: the path looked present in `openapi.json` while the operation the UI needed was missing. Two new components, `PmDraft` and **`PmDraftWithRecipient`** — the list route resolves each draft's recipient in a separate query and decorates the row, so what it returns is the model **plus** `toUser`, and registering the bare model would have been wrong in exactly the way that stays invisible until the UI binds to it. Three behaviours are documented because they are surprising rather than because they are shapes: `POST /messages/mass` is **capped at 1000 recipients** (`take: 1000`), so a larger site silently reaches only the first thousand; `GET /comments/{id}` carries **no auth middleware at all**, unlike the `PUT` and `DELETE` beside it, and is registered without `security` to say so; and `GET /forums/categories/{id}` filters its `forums` array by the caller's read class, so two members legitimately get different forums back for the same category.

- **Seven more routes join the OpenAPI contract — slice 2 of [#474](https://github.com/orphic-inc/stellar-api/issues/474), the auth surface** — `POST /auth/password`, `PUT /auth/email`, `POST /auth/recovery/request`, `POST /auth/recovery/reset`, `GET /auth/sessions`, `DELETE /auth/sessions/{id}` and `POST /install/checklist/{id}/dismiss`. Baseline **82 to 75**. Five new components come with them — `ChangePasswordBody`, `ChangeEmailBody`, `RecoveryRequestBody`, `RecoveryResetBody` and `UserSession`, the last mirroring the Prisma model whose `id` is a **cuid string, not an integer**, which is the kind of detail a hand-written type guesses wrong. **`auth.ts` is a high-risk area, and two responses are documented as the security properties they are rather than as tidy REST.** `POST /auth/recovery/request` is registered with **no 404 at all**: it always answers 200 with the same generic message whether or not the address belongs to an account, because a distinguishable response would turn it into an account-enumeration oracle — documenting a 404 there would describe an oracle the code deliberately avoids. `DELETE /auth/sessions/{id}` likewise documents **404 rather than 403** for another member's session id, since answering 403 would confirm the id exists. Error codes were read from `modules/auth.ts` rather than assumed: the change-password and change-email paths distinguish 401 (unauthenticated) from 400 (wrong password, disallowed password, email already taken), and the recovery reset returns 400 for an invalid or expired token.

- **Nine routes join the OpenAPI contract — slice 1 of the [#474](https://github.com/orphic-inc/stellar-api/issues/474) backlog** — the completeness gate made 91 unregistered routes visible; this registers the first nine and burns them out of the baseline, leaving 82. Sliced by router rather than by size, so each diff stays local to one section of `src/lib/openapi.ts` and shares Zod context. **This slice leads with `PUT /contributions/{id}/ratio-exempt`, the concrete blocker behind stellar-ui [#181](https://github.com/orphic-inc/stellar-ui/issues/181)** — the `ratioExempt` field was already in the contract, but the staff route that sets it was not, so the UI had nothing to bind a toggle to. Also registered: `GET /contributions/{id}` and `POST /contributions/{id}/report`; `GET /profile`, `GET /profile/me/ratio` and `GET /profile/me/reputation`; and `GET /notifications/unread-count`, `POST /notifications/read-all` and `POST /notifications/{id}/read`. Four new component schemas come with them — `ProfileSummary`, `CrsDimension`, `CrsView` and `RatioStats` — so the UI gets named types rather than inline shapes. `RatioStats` documents that `contributed`, `consumed` and `eligibleContributionBytes` are BigInt columns serialised as **strings**, which is exactly the kind of thing a hand-written type gets wrong. `GET /profile/me/ratio` is registered next to `RatioPolicyState` rather than in the Profile section, because its response embeds that schema and the consts are evaluated in file order; moving `RatioPolicyState` up instead would reorder `components.schemas` (they are emitted in registration order) and churn stellar-ui's vendored copy for no gain.

### Changed

- **The last lowercase tag in the OpenAPI registry is normalised** — `'requests'` was the only lowercase `tags:` value in the whole document, across the five registrations in that section, while every other section is TitleCase (`Forums`, `Communities`, `Users`, …). Left alone it would have split the requests group in two in the generated docs as soon as slice 7 added TitleCase entries beside it. Five one-line changes; no path, method or schema is touched.

### Fixed

- **Forum search returned every post body on the site, ignoring forum read class** ([#509](https://github.com/orphic-inc/stellar-api/issues/509)) — `GET /search/log` filtered on `deletedAt: null` and nothing else, while its `POST_SELECT` returns the full post **`body`**. Forum class is enforced everywhere else (`assertForumReadAccess` on the post and topic routes, `canAccessForumLevel` inside `getTopicSession`), but `search.ts` contained **no `minClassRead`, no `canAccessForumLevel` and no `userRankLevel` anywhere in the file**. This was reachable in the shipped default configuration: `bootstrap.ts` seeds forums at `minClassRead: 500` (Staff+), so any authenticated member could read staff forum posts by searching for them.

  **The rule had to travel into the query**, because a search has no single `forumId` to hand the existing assert. `modules/forumAccess.ts` now also exports `forumReadableWhere(user)` — the same rule as `canAccessForumLevel`, shaped as a `Prisma.ForumWhereInput`. Both arms matter: `permittedForumIds` admits a rank to a specific forum _below_ its read floor, so a level-only filter would have hidden forums a member was explicitly granted.

- **Release and request search ignored community membership** ([#509](https://github.com/orphic-inc/stellar-api/issues/509)) — `communityId` was only ever a caller-supplied _filter_ (`if (communityIds) where.communityId = { in: communityIds }`), never a restriction, so `GET /search/releases` returned releases from `PRIVATE` communities the caller does not belong to. `GET /search/requests` had the same gap and its projection carries the community's **name**.

  The contrast was one function deep and is what makes this a defect rather than a design choice: the browse path `GET /communities/{communityId}/releases` delegates to `listCommunityReleases`, whose first statement is `assertCommunityAccess`. **The same rows were gated on one path and open on the other.** `modules/communityAccess.ts` now exports `communityReadableWhere(userId)` — `open || roleUnion`, the same question `hasCommunityAccess` asks, as a `Prisma.CommunityWhereInput`.

  **A search filters where a browse refuses, deliberately.** `assertCommunityAccess` answers 403 because the caller named one community and is owed a straight answer; making search do the same would turn `?communityId=N` into an existence oracle for private communities, where a 403 rather than an empty page confirms N is real and private.

  **No contract change, and nothing downstream to re-vendor.** These routes filter rather than reject, so they answer no new status codes: `openapi:completeness` and `openapi:auth-coverage` both stay at zero, and stellar-ui owes no `api:sync` for this.

  **Two things this deliberately does not do.** `Release.communityId` is nullable, so the scope carries a `communityId: null` arm — without it the fix would have hidden community-less releases that were never private, turning a security fix into a regression. And the scope **appends to `AND`** rather than assigning it, because `tagMode=all` already puts an array there; the existing `tagMode=all` test now asserts both tag arms survive alongside the scope, which is the regression that would otherwise have been silent.

  **The release `where` is now built by per-spine helpers** rather than inline. The handler was over both of Codacy's Lizard thresholds before this change (**106 lines, cyclomatic complexity 30**) and the extraction takes it under both — `buildReleaseTextWhere`, `buildReleaseScalarWhere`, `buildReleaseArtistFilter`, `buildEditionFilter` and `buildContributionFilter`, assembled by `buildReleaseWhere`. Behaviour-preserving: the grouping follows the comments the inline block already carried, it matches the `buildTagWhere` helpers this file already had, and all 49 search tests — several of which assert exact query shapes — pass unchanged.

  **`GET /search/artists` needed no change** — `Artist` carries no community and the projection exposes name, vanity-house flag, tags and a credit count. An earlier note on #509 grouped it with the other two; that was wrong.

- **Any authenticated member could rename an artist, and `PUT /artists/{id}` reached around a permission gate two routes above it** ([#509](https://github.com/orphic-inc/stellar-api/issues/509) F3) — both `PUT` and `DELETE /artists/{id}` were `requireAuth` only, with no authorization anywhere: `src/modules/artist.ts` contained zero occurrences of `hasPermission`, `requirePermission`, `loadPermissions`, `AppError` or `403`. An artist row is a **shared catalogue entry with no ownership concept**, so a session alone authorized nothing.

  **The `PUT` was also a gate bypass.** It accepts `vanityHouse` and `updateArtist` writes it, while `PUT /artists/{id}/vanity-house` requires `news_manage` — so the gated field was settable through the ungated route. `PUT` now requires **`communities_manage`**, matching `POST /artists/revert/{historyId}`, which undoes exactly the edit this route makes; gating the undo more tightly than the do was the inconsistency. `DELETE` requires **`admin`**, since withdrawing a shared catalogue entry is not reversible through any route.

- **`DELETE /artists/{id}` could never have succeeded, and now soft-deletes instead** ([#509](https://github.com/orphic-inc/stellar-api/issues/509) F3) — the handler called `prisma.artist.delete()`, but **every artist relation that matters is `ON DELETE RESTRICT`** — `artist_histories`, release credits, tags, aliases, comments, bookmarks, subscriptions and both similar-artist sides — and `createArtist` writes an `artist_histories` row **at creation**. So any artist created through the API had a restricting child from birth, and the route could only ever raise a foreign-key error the global handler renders as a **500**.

  This corrects the severity recorded on #509, which said any member could "hard-delete any artist". They could not: on a real artist the call failed. The authorization hole was real; the deletion was not.

  `Artist` gains a nullable `deletedAt` (migration `20260906000000_artist_soft_delete`), the same shape as `20260831000000_author_stylesheet_soft_delete`. **A soft delete is the only way this route can succeed at all** without either cascading away an artist's edit history and credits, or refusing every artist that has ever been touched.

  **Discovery filters; existing references keep resolving.** The artist list, the vanity-house list, artist search, the random artist, the detail read, subscribe, and the three artist counts in site stats all exclude withdrawn rows — matching how stats already treats soft-deleted forum topics and comments. Release credits and notification labels deliberately still resolve: withdrawing a catalogue entry must not blank the artist line on every release that cites it, or retroactively strip a delivered notification of its subject.

  **Contract change**: `PUT` and `DELETE /artists/{id}` now declare the `403` their middleware answers (`Missing communities_manage` / `Missing admin`). `openapi:auth-coverage` caught both as gaps the moment the gates landed, which is the sixth axis doing its job. **stellar-ui owes an `api:sync` for this one** — unlike the search fix, which only filtered.

- **`GET /comments/{id}` served soft-deleted comment bodies to anyone, with no session** ([#509](https://github.com/orphic-inc/stellar-api/issues/509) F4) — two defects in one route. It was the **only comment route with no `requireAuth`**, and it did not filter `deletedAt`, which the sibling `GET /comments` applies at both its `findMany` and its `count`. `deleteComment` only stamps `deletedAt` and **keeps the body verbatim**, so a withdrawn comment's text was readable by guessing an integer id, unauthenticated.

  **The registry described this as intentional.** Its `description` read _"Deliberately unauthenticated — this route carries no auth middleware, unlike the PUT and DELETE beside it. It also does NOT filter `deletedAt`, so unlike GET /comments it can serve a soft-deleted comment."_ That text came out of [#494](https://github.com/orphic-inc/stellar-api/issues/494)'s burn-down, whose job was to describe what routes **do**, not to ratify it — accurate documentation of a defect is still a defect. The description now states the fixed behaviour.

  **No downstream cost.** stellar-ui's `commentApi` reads `/comments` for the list and `/comments/{id}` only for `PUT` and `DELETE`; it never GETs this route, so the gate breaks nothing.

  **Contract change**: the route now declares its `401`, and its `404` covers the soft-deleted case. `openapi:auth-coverage` moved from **347 gated / 347 documented** to **348 / 348**, having flagged the new 401 as a gap the moment the gate landed.

  **The 401 is not unit-tested, deliberately.** `apiTestHarness` mocks `requireAuth` to always succeed, so no spec in that suite can make an unauthenticated request — a test claiming to check the gate would pass whether or not the route carried it. The mechanical proof is `openapi:auth-coverage`, which reads gates off the **built app** via `markGate`/`readGate` and would fail on a regression that dropped the middleware.

- **A real 403 gate the auth-coverage machinery could not see** ([#509](https://github.com/orphic-inc/stellar-api/issues/509) F7) — `forumTopicNote.ts` defined its own `requireModerator`, which checked `forums_moderate` and answered 403, but was never `markGate`d. `readGate()` returned `undefined`, so the built app classified `GET /forums/topic-notes/{topicId}` and `POST /forums/topic-notes` as `auth`-only, and `expectedCodes(['auth'])` is `[401]`.

  **The contract was right anyway — nothing was holding it there.** Both routes already declared their 403 because a human registered them correctly. The defect was that deleting those declarations would not have failed anything: a silent hole in the sixth guarded axis, of exactly the species this repo keeps finding — _a check that looks authoritative while measuring the wrong thing_.

  **Verified by breaking it on purpose**: removing the 403 from `GET /forums/topic-notes/{topicId}` now fails `openapi:auth-coverage` with `1 gap(s)`. Before this change the same deletion left the gate green.

  **Fixed by deletion rather than annotation.** A one-line `markGate(requireModerator, 'permission')` would have closed the hole, but `requireModerator` was **the only locally-defined gate middleware in the entire routes tree** — every other gate already lives in `middleware/`. Both call sites now use the shared `...requirePermission('forums_moderate')`, which is identical in semantics (`hasPermission(perms, 'forums_moderate')`, via the same `loadPermissions`) and additionally brings the `secLog.warn('Permission denied', …)` audit line and the `try/catch → next(err)` the local copy lacked — an async rejection in the local version would not have reached the error handler. The gate machinery now reads `[auth, permission]` on both routes.

  **One response-body string changes**: the 403 message goes from `Not authorized` to `Permission denied`, the shared gate's wording. Checked against stellar-ui before making it — the only occurrences of `Not authorized` there are OpenAPI _descriptions_ in the generated `openapi.json`/`api.ts`, never a runtime comparison, so no UI branch depends on it. The two descriptions now read `Missing forums_moderate`, matching the #494 convention.

  `DELETE /forums/topic-notes/{id}` is deliberately untouched: its 403 is a handler-level author check, which remains invisible to the gate by design and is tracked under #509's third axis.

- **A community's Do-Not-Contribute list was readable from any other community** ([#509](https://github.com/orphic-inc/stellar-api/issues/509) F5) — `GET /communities/{communityId}/dnc` carried `requireAuth` and nothing else, so any authenticated member could enumerate any community's list by id, including the free-text `comment` staff write about **why** something is banned. The handler signature was `authHandler(async (_req, res)` — the underscore is the tell: the caller's identity was never consulted, while `POST` and `DELETE` on the same path require `dnc_manage`.

  **The route is deliberately member-facing and stays that way.** stellar-ui renders this list in `ContributeForm` as the _"must not be contributed to this community"_ warning, so a contributor has to be able to read it — a staff-only gate would have removed the very thing that prevents bad contributions. The audit originally read this as a leak of staff data; that was wrong, and `dnc.spec.ts`'s test named `'returns the DNC list for any authenticated user'` was recording a real intent rather than rubber-stamping an oversight. What was never intended is cross-community reads.

  Scoped with `assertCommunityAccess` — the same `open || roleUnion` rule the browse paths use.

  **No UI impact, verified rather than assumed.** `GET /communities` already filters its list by exactly `{ OR: [open, communityRoleUnion(userId)] }`, and that list feeds the form's community picker — so a member can only ever select a community they already pass this gate for, and the warning banner is unaffected.

  **The gate could not catch this one.** `assertCommunityAccess` throws from _inside_ the handler, so the middleware-chain reader sees `[auth]` and `openapi:auth-coverage` stayed green at `348/348` across the change. The 403 and 404 were registered by hand. This is exactly the blind spot [#509](https://github.com/orphic-inc/stellar-api/issues/509)'s third axis describes, and the reason a handler-level authorization audit cannot be replaced by the sixth axis.

- **Contribution detail served anyone's contribution to any member, by id** ([#509](https://github.com/orphic-inc/stellar-api/issues/509) F6) — `GET /contributions/{id}` had no ownership check and no community check, which put it at odds with **its own sibling**: `GET /contributions` is `where: { userId: req.user.id }` — your own contributions only — while the detail read served anyone's. The two routes disagreed about what a contribution read is.

  It does **not** expose `downloadUrl` (the list does, for your own rows, and grants go through `/contributions/{id}/access`), so this was metadata rather than access: contributor identity, sizes, `approvedAccountingBytes`, `ratioExempt`, link status, the release and its comments.

  **Now readable if you own it, or if you can reach the release's community.** Ownership is tested first and independently of the community, which is the case worth stating: a member who contributed and later lost access to that community still sees the row in their own `/contributions` list, so refusing them the detail would make their own list link to a 403.

  **`Release.communityId` is nullable**, and a release with no community has no membership to test — gating those would hide rows that were never community-scoped. The same arm the search scope carries for the same reason.

  **The gate could not catch this either.** Like [F5](https://github.com/orphic-inc/stellar-api/issues/509), `assertCommunityAccess` throws from inside the handler, so `openapi:auth-coverage` stayed green at `348/348` throughout and the `403` was registered by hand.

- **Four more enum columns registered as free text, and a whole-row read missing four columns** — surfaced while binding `top10Api`/`adminApi` for [stellar-ui #293](https://github.com/orphic-inc/stellar-ui/issues/293). **The earlier sweep's claim that no enum column was left described as a string was wrong.** That pass matched on field NAMES (`type`, `status`, `kind`, `targetType`, `category`), which misses any enum whose column is called something else — so this pass enumerated **every enum-typed column in `schema.prisma`** and checked each against the registry instead.

  Four genuine misses: **`Community.registrationStatus`** (`RegistrationStatus`, `NOT NULL`, and wrongly `nullable().optional()` — the identical shape to `Community.type`, fixed in the same PR and missed here only because the field is not called `status`), **`Notification.page`** (`SubscriptionPage`), and **`reason` on both economy components** (`EconomyTransactionReason`). Nine other name-matches were checked and are genuinely `String` columns — `reason` is free text on six other components, which is exactly why name-matching is not a substitute for reading the column.

  **`EconomyTransactionItem` was also under-described.** `GET /stats/economy` reads `recent` with `include: { user }` and **no `select`**, so the whole `EconomyTransaction` row is on the wire; the registration declared five of its nine fields, omitting **`userId`, `contextId`, `contextType` and `actorUserId`**. Same omission class as the `siteApi` four and `Notification.userId`.

- **Thirteen more registry fields described an enum column as free text — the registry now has none left** — the completion of the `ReleaseCategory`/`ReleaseType` pair. Eight enums, audited against `schema.prisma` rather than by pattern-matching field names: **`FileType`** (`Contribution.type`, `ReleaseContribution.type`, `ReleaseContributionDetail.type`), **`CommunityType`** (`Community.type`, which was also wrongly nullable-and-optional for a `NOT NULL` column every route returns whole), **`ReportStatus`** and **`ReportTargetType`** (the report summary), **`InviteStatus`**, **`RatioPolicyStatus`**, **`DownloadGrantStatus`**, **`AssetKind`**, and **`RequestStatus`** — that last one on `requestSearchItem.status`, which described the _same column_ `Request.status` had already been registering correctly as `z.nativeEnum(RequestStatus)`. `CommunityHealthSnapshot.status` is now the closed union `computePulse()` actually returns (`Healthy | Ailing | Critical | Unknown`); it is not a Prisma enum, so it is spelled out.

  **Three fields that look identical were checked and deliberately left as strings**: `Post.category` and the report `category` on two objects are genuinely `String` columns (`@db.VarChar(50)` for the report — it holds either a release-category value or free text depending on `targetType`, per the `POST /reports` union). Matching on `category: z.string()` would have narrowed a field that is legitimately open.

  **`AssetUploadResponse.kind` is the one that repaid reading the projection.** The upload route restricts `?kind=` to `z.enum(['ThemeImage','Avatar'])` — `ThemeFont` is excluded on purpose — so the obvious registration is that two-value subset. It would have been wrong: the store is **content-addressed**, and `putAsset()` returns the _existing_ row on a hash hit, so the echoed `kind` can be any `AssetKind` including a seeder-planted `ThemeFont`. Registered as the full enum.

- **`GET /users/invites?status=` answered 500 for any value outside `InviteStatus`** — the one behaviour change here, and a real bug rather than a description problem. `invitesQuerySchema` validated `status` as `z.string().optional()` and the route handed it to Prisma with a `status as never` cast, so an unrecognised value reached the query as an invalid enum member, threw `PrismaClientValidationError`, and fell through the global handler's `err.statusCode ?? 500`. It is now validated as `z.nativeEnum(InviteStatus)`, answers **400** like every other rejected query value, and the cast is gone. A regression spec pins all three cases and was verified to fail against the old code.

- **`type` was `z.string()` in six more places, for the other enum on a release** — the sibling of the `releaseType` fix above, and the reason the two are easy to confuse: **`type` (`ReleaseType`) is the MEDIUM** a release is — `Music`, `Applications`, `EBooks`, `ELearningVideos`, `Audiobooks`, `Comedy`, `Comics` — while **`releaseType` (`ReleaseCategory`) is the EDITION KIND** (Album, Single, Live…). They sit next to each other on every release-shaped response and both had been free text. Now `z.nativeEnum(ReleaseType)` and required at all six: `Release`, the artist detail's `releases[]`, `Request`, `Top10ReleaseItem`, and the release and request search items.

  **`Request.type` is the same column, which is why it is in this change** — `Request.type` is a `ReleaseType` too, and `serializeRequest()` takes it as one and always emits it. (`SerializedRequest` widens it back to `string` in the module's own type; that is a separate looseness, left alone.) The same three-nullability pattern as before: nullable-and-optional on `Release`, optional on `releases[]`, required-but-free-text on the other four.

  **Deliberately NOT swept: `Contribution.type` and `Community.type`.** They match `type: z.string()` textually and have the identical bug, but they are **different enums** — `FileType` (mp3, flac, …) and `CommunityType`. Each wants its own change with its own projection check, and folding three enums into one diff would have made the blast radius impossible to review. The six sites here were edited **by line number** rather than by string replacement precisely because `type: z.string(),` is textually identical on the sites that must not change; the emitted spec confirms `Contribution`, `Community` and `ReleaseContribution` are untouched.

- **`releaseType` was `z.string()` in five places with three different nullabilities, for a column that is a fourteen-value enum** — `Release.releaseType` is a `ReleaseCategory` column, `NOT NULL`, and **every projection that returns a release selects it**. The registry described it as nullable-and-optional on `Release`, optional on the artist detail's `releases[]`, and required-but-free-text on `Top10ReleaseItem`, `CollageEntry` and the release search item. All three shapes were wrong in the same direction: they told a client the field might be absent, might be null, and could hold any string at all. It is now `z.nativeEnum(ReleaseCategory)` — **sourced from the Prisma enum rather than a literal `z.enum([...])`, so it cannot drift from the fourteen values the database accepts** — and required everywhere.

  **Each of the five was checked against its projection rather than assumed from the column.** The two community release routes and the workbench read return the whole row (`include:` with no `select:`); the artist detail spreads `credit.release` whole; `search.ts`'s `RELEASE_SELECT` names `releaseType: true` explicitly; and the top-10 item comes from raw SQL that selects `r."releaseType"`. The column being non-null would not have been enough on its own — a projection that omitted the field would still make it optional, which is exactly the `WikiPage`/`makePage()` mistake this exercise keeps re-teaching.

  **Verified against the generated client before committing**, per the `.extend()` narrowing trap: `openapi-typescript` emits a clean fourteen-member union, not the `Base & Record<string, never>` an ill-formed narrowing produces, and stellar-ui type-checks clean against it — narrowing a **response** field is safe for readers, which is why this needed no consumer change. The emitted document keeps all **361** operations and adds no component.

- **The last twelve entries in the OpenAPI completeness baseline are gone, and the file is now empty** ([#474](https://github.com/orphic-inc/stellar-api/issues/474)) — these were the routes registered under a different **parameter name** than the code uses. They had been carried as "cosmetic, path shapes match", which undersold them: the registered path string is the **key** in the generated client, so a mismatch means `paths['/forums/{forumId}/topics/{topicId}']` in stellar-ui names a parameter the server does not. They split into two unrelated problems.

  **Eleven were the forum routes, and were fixable entirely inside this repo.** The registry said `{topicId}`; the Express routes said `:forumTopicId`. **An Express parameter name never appears on the wire** — it is a local binding — so renaming the routes to `:topicId` settles the disagreement with **no contract change and no consumer change at all**, which is why it was done in that direction rather than by editing the registry. The code was already leaning that way: `forumTopic.ts` destructured `forumTopicId: topicId` to get a workable name, and `forumPoll.ts` and `forumTopicNote.ts` had used `:topicId` all along. **`ForumPost.forumTopicId`, the actual database column, is untouched** — it shares a spelling with the route parameter and nothing else, and the Prisma `where` clauses that relied on shorthand now name it explicitly.

  **The twelfth was a disagreement inside the registry itself.** `GET /communities/{id}/releases` was registered with `{id}` while the **`POST` on that same path** was registered with `{communityId}`, which is also what the router mounts (`/:communityId/releases`). So one operation of a two-operation path disagreed with both the code and its own sibling, and the spec carried the path **twice** as a result. Corrected to `{communityId}`, which merges them into a single path object. The emitted document keeps all **361 operations** and its `components` are byte-identical; exactly one operation key changes, and stellar-ui's one read of it moves with it.

- **Two integration factories named rows with a millisecond timestamp, so a test that called one twice collided on a `@unique` column** — `contributions.integration.ts` and `releaseWorkbench.integration.ts` built communities as `` `Community-${Date.now()}` ``. `Date.now()` has millisecond resolution and `Community.name` is `@unique`, so any test calling the factory twice in a row failed with `Unique constraint failed on the fields: (name)` whenever both inserts landed inside the same millisecond. **It is not theoretical: a local INSERT measures ~0.2 ms, and CI's Postgres has run on tmpfs since [#467](https://github.com/orphic-inc/stellar-api/issues/467)** — so the change that made the integration suite 15x faster is what made this latent bug start firing. It took down an unrelated PR's `integration` job, where it reads as a mysterious red on a branch that touched none of it.

  **The uniqueness scheme is now one shared `uniqueName(prefix)` in `src/test/dbHelpers.ts` rather than twenty hand-rolled ones.** Across `src/integration/` the same idea had been re-derived about four different ways — `${Date.now()}-${Math.random()}`, `${seq}-${Date.now()}`, `${tag}-${Date.now()}`, and the bare timestamp — and the two that omitted a per-call differentiator were the ones that broke. **A monotonic counter provides the uniqueness and cannot collide within a process**, which is the only scope that matters, since `truncateAll()` runs in `beforeEach` and no row outlives its test. `Date.now()` is kept purely so a name stays recognisable in failure output; treating it as the uniqueness mechanism is precisely the mix-up that caused this.

  **The regression test freezes the clock**, because a race cannot be pinned down by running the code and hoping. With `Date.now()` mocked to a constant the pre-fix scheme collides on _every_ call instead of the unlucky ones, so `uniqueName.spec.ts` fails deterministically against the old code — verified — rather than flaking the way the bug did. It is a unit test, not an integration one: extracting the helper is what made the logic testable without a database.

  Only the two broken files are migrated. The eighteen that already differentiate correctly are left alone — they are not buggy, and churning them would be a refactor rather than a fix — but `uniqueName` is the thing to reach for in new code.

- **A `Weekly` top-10 snapshot stored the DAILY leaderboard, and `GET /top10/history` served it** ([#491](https://github.com/orphic-inc/stellar-api/issues/491)) — `createSnapshot()` hardcoded `getTopReleases({ type: 'day' })` and wrote the caller's `type` to the `Top10Snapshot.type` column as a **label only**, so the argument never reached the query. `getTopReleases` has always supported `'week'` (a real 7-day window in `windowStart`); it simply was not passed through. Because `getHistorySnapshot()` filters on that column (`where: { type }`) and the model carries `@@index([type, createdAt])`, the column is a genuine discriminator between two datasets — so every consumer asking for the weekly leaderboard was reading the daily one under a Weekly heading. `Daily` rows were always correct, since `'day'` was what the hardcode requested.

  **A migration deletes the mislabelled rows.** They are not merely stale, they are indistinguishable from correct Weekly rows, so leaving them would mix wrong history into right history permanently. The delete carries **no date bound, deliberately**: the fix ships in the same deploy, so at the moment the migration runs every Weekly row predates it by construction and there is no such thing as a correct one yet. `top10_snapshot_entries` cascades; `Daily` rows are untouched.

- **`POST /top10/snapshot` had no request validator, the last such route in the API** ([#491](https://github.com/orphic-inc/stellar-api/issues/491)) — it read `req.body?.type` directly and coerced **anything that was not exactly the string `'Weekly'` into `'Daily'`**, so `'weekly'`, `'WEEKLY'`, a typo or a number all returned `200` and built the wrong snapshot. It was a live exception to AGENTS.md's "always run `validate(schema)` before the handler", and the one request body in `src/lib/openapi.ts` that [#490](https://github.com/orphic-inc/stellar-api/pull/490) could not rewire to its validator because no validator existed. It now runs `validate(snapshotSchema)`, answers `400` on a bad value, and its registration references that schema — so **all 21 request bodies are now projections of the validator that enforces them**, closing #490's remaining gap.

  **The two were one decision.** Validating a value that still could not change the result would have been a route that carefully checks its input and then ignores it. `snapshotSchema` sources its enum from Prisma's `Top10SnapshotType` rather than a literal `z.enum(['Daily','Weekly'])` — unlike the sibling `historyQuerySchema`, which only reads the column, this schema decides what gets **written** to it and should not be able to drift from it. **An absent body still means Daily**, which is the cron's call and the one permissive behaviour deliberately kept.

  **The old test was green throughout, and that is the point.** `top10.spec.ts` covered this route including a case named `passes Weekly type when body.type is Weekly` — but it mocks `modules/top10` wholesale, so it asserted only that the route forwards the string and never saw the hardcode one layer down. The same structural blind spot #474 kept surfacing. A new `top10Snapshot.spec.ts` exercises the **real** `createSnapshot` against a mocked Prisma and asserts on the window boundary bound into the `$queryRaw` call — the last observable point before the database, and the first that can tell a Daily snapshot from a Weekly one. It was verified to **fail on the pre-fix code** before being kept.

- **Four `UserRank` fields the routes always send were missing from the contract, two of them live reads in the staff UI** ([#474](https://github.com/orphic-inc/stellar-api/issues/474), the `userApi` three-way diff) — all four `/tools/user-ranks` routes (list, read, create echo, update echo) project the **same** `formatRank()` helper, which builds its object field by field and emits every one of them unconditionally. The registered `UserRank` declared thirteen fields, **omitted `secondary`, `permittedForumIds`, `primaryUserCount` and `secondaryUserCount` entirely**, and marked nine of the thirteen it did declare optional. **`secondary` decides whether a rank is Primary or Secondary** — the rank manager's Type column reads it, the rank form initialises its checkbox from it, and the profile rank pickers `filter()` the ladder into primary and secondary lists with it. **`permittedForumIds` backs the Forum Overrides count and the whole permitted-forums picker.** Binding `userApi` to the contract as registered would have deleted both from the client, silently.

  Same omission class as the `siteApi` four, `Notification.userId` and the `adminApi` two — the registry under-describing a projection that returns everything it builds. The nine spurious `optional()`s are the milder half of the same error: a required field described as optional forces every consumer into a `?? 0` it does not need, and `UserRankManager` carries three of those today. Only `assetLimit` and `staffGroupId` stay nullable, both because the column is (`Int?`), and for `assetLimit` **null means uncapped, not absent** (#342) — which is precisely why it cannot also be optional.

  **The rest of `userApi`'s registry survived the diff intact**, which is worth recording after eleven services that did not. `PromotionRule` matches `formatPromotionRule()` field for field across all four of its routes, including `minContributed` as a string (bytes, past `MAX_SAFE_INTEGER`) and the nullable `extra` enum; `UserRankState`, `DonorRank`, `SnatchItem` and the two history arrays all match their handlers; and `UserWarning`/`UserModerationNote` correctly mark `warnedBy`/`author` optional because the read routes include the relation and the create echoes do not.

- **Two admin-surface columns the routes always send were missing from the contract** ([#474](https://github.com/orphic-inc/stellar-api/issues/474), the `adminApi` three-way diff) — **`FeaturedAlbumItem.image`**, a real column (`String @default("")`) returned by both the album-of-the-month list and its create echo, which each hand back the whole row; and **`InviteTreeItem.createdAt`**, likewise on the wire because `getInviteTree()` returns the whole `InviteTree` row plus its two relations. Same omission class as the `siteApi` four and `Notification.userId`: the registry under-describing a whole-row projection.

**Two fields went the other way, and are left alone because the contract is the accurate one** — the first time that has happened in this exercise. stellar-ui types `RegistrationLogUser.email` as `string | null`, but `User.email` is `String @unique` and the route selects it directly, so it is never null; and it types `InviteTreeItem.inviterId` as non-nullable when the column is `Int?` and the registry already says so. Both are the UI being wrong in the harmless direction — over-cautious on one, over-narrow on the other — which is worth recording precisely because the running lesson has been the reverse.

- **`GET /auth/sessions` never sent `isCurrent`, so the session manager could not mark the session you were using** — found by the same `#277` straggler diff, and it is the **second shipped UI bug this exercise has turned up**. The route returned raw `userSession` rows; stellar-ui's hand-written `SessionItem` declared an `isCurrent: boolean` the API has never sent. So `session.isCurrent` was `undefined` at runtime, which meant the **"(this session)" badge never rendered** and — because the Revoke button is gated on `!session.isCurrent` — **Revoke was offered on every row, including the one the user was browsing with**. `tsc` was clean throughout, and the Settings test fixture supplies `isCurrent: true`/`false` on its rows, so **the suite agreed with the type rather than with the API** and the true branch was never exercised against real data. Same mechanism as the `requestApi` bounty-history bug, and the fourth instance of a fixture corroborating the thing it was derived from.

**The client cannot compute this itself** — the session id lives in the HttpOnly token — so the fix is server-side. The auth middleware already decodes `sessionId` to check for revocation; it now carries it onto `req.user`, and the list marks each row. **`src/types/express.d.ts` restated `AuthUser`'s fields instead of referencing it**, which is the same "two descriptions, nothing comparing them" pattern one level down in the type system: adding `sessionId` to `AuthUser` compiled, and only the augmentation's independent copy rejected it. It now references `AuthUser`. A regression test pins the behaviour — it fails against the old handler and passes against the new one — and the shared test harness now authenticates as a fixed session id so any route that reads it is testable.

- **`CommunityVoteState` typed both of its fields as integers, and neither is one** — the release vote routes answer `{ myVote, voteAggregate }`, where `myVote` is the direction the workbench just applied (`positive ? 'up' : 'down'` on `POST`, null on `DELETE`, which votes with direction `'clear'`) and `voteAggregate` is **the whole `ReleaseVoteAggregate` row** read back with `findUnique` after recompute — so it is `{ id, releaseId, ups, total, score, updatedAt }`, and **null** when the release has no aggregate row yet. The registry described `myVote: integer|null` and `voteAggregate: integer` (required). **stellar-ui's hand-written types had both right** — `'up' | 'down' | null` and a nullable object — which is the ninth time the UI's version has been the accurate one. Found by a type probe during the binding, _after_ a top-level field-name diff had reported the component as clean: comparing key sets does not descend into a field's shape, and this one was wrong two levels down.

- **`Notification.source.url` was missing, and the UI's global-notice banner reads it** — the enrichment loop sets a different `source` per `page` branch, and only the `global_notices` branch carries `url` (`{ title: g.message, url: g.url ?? undefined }`). The registered shape declared `title`, `forumId`, `releaseId` and `communityId` but not `url`, so binding `notificationApi` to the contract broke `GlobalNoticeBanner` and `NotificationCorner` at compile time — which is the gate doing its job, and the reason to bind rather than hand-write.

- **`Notification.userId` was missing from the contract** — `GET /notifications` returns `{ ...n, source }` off a `findMany` with no `select`, so every column is on the wire. stellar-ui's hand-written type had `userId` and the registry did not, so binding the service to the contract would have silently dropped it. Same omission class as the `siteApi` four.

- **One `Comment` component described four different projections, and three artist routes were registered as "shape unknown"** ([#474](https://github.com/orphic-inc/stellar-api/issues/474), the `#277` straggler diff) — the `WikiPage` failure again, in two more places, found the same way: by diffing stellar-ui's hand-written types against the registry before binding them. **`routes/api/comments.ts` projects three shapes and every one returns the row by spread**, so all fourteen scalar columns are on the wire — the component declared **six**. What differs between the routes is which relations are included: the list includes `author` **and** `editedUser`, `GET /comments/{id}` and the `201` include only `author`, and **`PUT /comments/{id}` echoes a bare `tx.comment.update()` with no include at all, so it carries neither**. One optional-everything component covering all four told a client that `author` might be missing from the three responses that guarantee it, and might be present on the one that never sends it. Now `Comment` (author guaranteed), `CommentWithEditor` (the list rows) and `CommentUpdated` (scalars only). Spelled out from a shared scalar base rather than chained `.extend()`, because `CommentUpdated` **removes** a field the others carry and an extend cannot narrow — the api#488 trap. `deletedAt` is registered nullable and the by-id read now says why: **it does not filter `deletedAt`**, so unlike the list it can serve a soft-deleted comment.

**The three artist join routes were registered as `z.record(z.unknown())`** — an admission that the shape was unknown, which handed every consumer `{ [key: string]: unknown }` and gave nobody a reason to prefer the contract over a hand-written guess. All three return the raw row from an `upsert`/`create` with no `select`, so the shape is exactly the Prisma model: `SimilarArtist`, `ArtistAlias` and `ArtistTag` are now real components. **`SimilarArtist` already existed and described neither route that uses it** — it declared _only_ the nested `{ similarArtist: { id, name } }`, so it omitted every scalar `GET /artists/{id}/similar` carries and named a relation the create echo does not have. Split into `SimilarArtist` (the bare row, what `POST` echoes) and `SimilarArtistEntry` (the row plus the included artist, what the list serves), the second **extending by adding**, which is the direction that generates correctly.

- **`PUT /rules/{id}` documented neither of the two errors it can answer** ([#474](https://github.com/orphic-inc/stellar-api/issues/474), `rulesApi` three-way diff) — the route runs `validate(updateRulesPageSchema)`, so it answers **400** with a `ValidationError`, and it throws `AppError(409, 'A main rules page already exists')` when an update promotes a second page to `isMain`. It declared only `200` and `404`. **`POST /rules` performs the same `isMain` conflict check and documents both codes**, so this was an inconsistency inside a single router rather than an undocumented design — the update path was registered as if it were incapable of a conflict the create path guards against identically. Nothing else in the rules registry moved: `RulesPage` matches `pageSelect` exactly, all four page-returning routes project that same select (no `WikiPage`-style split), and `main` is correctly nullable because the list uses `findFirst`.

**Path parameters were left as `z.string()` deliberately.** `rulesPageParamsSchema` coerces `id` to a positive integer, but the emitted spec types **236 of its 240 path params as `string`** — which is also what a URL path segment is. Changing these four to match the coercion would break with the convention everywhere else and churn stellar-ui's vendored spec for no gain.

- **Four site-contract fields the routes have always sent were missing from the registry** ([#474](https://github.com/orphic-inc/stellar-api/issues/474), `siteApi` three-way diff) — found the same way as the wiki, request and collage corrections, by diffing stellar-ui's hand-written `siteApi` types against the registered components before binding them. **These fail in the opposite direction to the first three services.** Those were over-promises: a component claiming a field the route does not send, which a bound client null-checks harmlessly. These are **omissions**, and an under-described contract is worse — binding to it silently **drops** fields the response actually carries, so `maxUsers` and `dismissedLaunchChecklist` would both have vanished from a UI that was already reading them. **`SiteStats.maxUsers`** is returned by `getSystemStats()` (first, ahead of the counts — it is a capacity figure read off the `SiteSettings` row, not one of them). **`SiteSettings.dismissedLaunchChecklist` and `.installedAt`** are on the row because `getSettings()` and `updateSettings()` both `upsert` with **no `select`**, so `GET` and `PUT /settings` each return the whole record; `installedAt` is `DateTime?`, null until `POST /install` stamps it, and is registered nullable. **`SiteStatSnapshot.bucketAt`** is present because `getSiteStatHistory()` returns raw rows — it is the `@unique` column the hourly/daily capture upserts against, and is distinct from `capturedAt`, which records when the row was written.

**Two of the four were missing from stellar-ui's hand-written types as well, which is a genuinely new failure mode for this exercise.** The running lesson has been "the UI type is the accurate one, treat a disagreement as evidence the contract is wrong" — 7 for 7 before this. But `installedAt` and `bucketAt` are absent from _both_ descriptions, so there was no disagreement to notice: the two hand-written artifacts agreed with each other and both under-reported the handler. That is the same mechanism as the `makePage()` fixture agreeing with the registration it was derived from, one layer out. **Only the projection is evidence** — agreement between any two descriptions is not.

**`UserStatSnapshot` was checked and needed nothing**, which is worth recording because it is the second component in this whole effort to survive a three-way diff intact. `getUserStatHistory()` maps its rows **explicitly** rather than returning them, so `bucketAt` is correctly absent, and `contributed`/`consumed` are genuinely nullable — null is what a viewer who fails the `showContributedStats` / `showConsumedStats` privacy gate receives, not a missing value.

**Worth a separate decision, not changed here:** `GET /settings` is `requireAuth` only — **any authenticated member** — while `PUT` is admin. Both return the whole row, so `installedAt` and `dismissedLaunchChecklist` (an admin-workflow list) have always been readable by every logged-in user. Registering them documents that rather than introducing it; narrowing the read would be a response-shape change.

- **Twenty of the twenty-one hand-copied request bodies in the OpenAPI registry now reference the schema that actually validates the route** — `src/lib/openapi.ts` described 21 of its 121 request bodies with an inline `z.object({...})` transcribed by hand, while the other 100 referenced the real `*Schema`. **This is the one half of the contract problem that has a single source of truth**: a response shape has no artifact to check against, which is why registry errors keep surfacing only when a consumer binds to them, but a request body already has one — the Zod validator the route passes to `validate()`, which is what the server enforces. Referencing it does not add a gate; it **deletes the drift class**. Nine of the twenty were already wrong. **`PUT /settings` omitted `dismissedLaunchChecklist` entirely**, a field `updateSettingsSchema` accepts and the route writes, so a client bound to the contract could not send it. **`POST /reports` flattened a two-variant union into one object** — `fileReportSchema` discriminates on `targetType`, requiring a 34-value `releaseCategory` enum for a Release and a free-text `category` for the other eight target types; the hand-copy typed `targetType` as an open string and made **both** category fields optional, so the spec permitted a Release report with no category and a `targetType` the server rejects. **`POST /downloads/{grantId}/reverse` and `POST /communities/{communityId}/dnc` each marked a field required that its schema makes optional** (`reason`, `comment`) — and stellar-ui's hand-written `downloadApi` already had `reason?: string`, so **for the seventh time the UI's type was the accurate one and the contract was wrong**. `POST /reports/{id}/resolve` gained the 7-value `resolutionAction` enum in place of a bare string, and four more picked up length, format and default constraints the validators have always enforced. The remaining twelve were faithful transcriptions and their emitted spec is byte-identical — no component was added, moved or renamed, so `components.schemas` stays at 169 and stellar-ui's vendored copy sees only the nine corrected bodies.

  Eight schemas had to **move into `src/schemas/`** to be referenced at all, because they were declared as module-local consts inside their route files and nothing in `lib/` may import from `routes/` — `routes/api/docs.ts` imports `lib/openapi.ts`, so the dependency would have inverted the layering. They follow the documented one-file-per-domain convention, three of them in new files (`schemas/friends.ts`, `schemas/ratioPolicy.ts`, `schemas/donations.ts`), and are qualified where a route-local name would be ambiguous in a shared namespace (`reportSchema` → `contributionReportSchema`, `commentSchema` → `friendCommentSchema`, `overrideSchema` → `ratioPolicyOverrideSchema`).

  **`POST /top10/snapshot` is the one exception and stays hand-written, now with a comment in the source saying why: there is no schema to reference.** `routes/api/top10.ts` reads `req.body?.type` directly and coerces anything that is not exactly `'Weekly'` into `'Daily'`, so the route accepts any body at all — a live exception to AGENTS.md's "always run `validate(schema)` before the handler". The registration describes what ships; adding a validator would be a behaviour change and is tracked separately. **`PUT /artists/{id}/vanity-house` is a near-miss worth naming**: its schema moved and is now referenced, but the route still hand-rolls `.safeParse` instead of using `validate()`, so it answers a `{ msg }` on a bad body where every other validated route answers `{ errors }`. Switching it would change a response shape, so it is left alone and recorded here.

- **Four collage fields described a shape the routes do not send** ([#474](https://github.com/orphic-inc/stellar-api/issues/474) slice 4, corrected) — found by the same three-way diff before binding stellar-ui's `collageApi`. **Slice 4 is the best-built section of this registry** — `Collage`, `CollageDetail`, `CollageEntry` and `DeletedCollageItem` already separate the projections, and `CollageDetail` extends by _adding_ properties, so it generates correctly — which is why these are four field-level corrections rather than a structural one. **`Collage.descriptionHtml` was optional and is always present**: list, detail, create, update and recover each add it explicitly, and the only collage read that omits it has its own `DeletedCollageItem`. The component's own comment said it "recurs on every collage response that returns a body" and then marked it optional, which is as close to a written-down contradiction as this exercise has produced. **`CollageEntry.release.year` and `.releaseType` were nullable and neither column is** — `year Int` and `releaseType ReleaseCategory` are both required in the schema, so the nullability described a response the route cannot produce. **`communityId` is now optional, and it is the one field where the two entry selects genuinely differ**: the detail route selects it, the add-entry `201` does not. It stays `nullable` when present, because the column is `Int?`. The two selects are **not** split into separate components over a single nested id — that would be the WikiPage remedy applied where it is not earned. `artist` was already correct: `withPrimaryArtist` returns null for a release with no credits at all, and stellar-ui's non-null hand-written version is the wrong one there.

**Not changed, and deliberately so:** `releaseType` is registered as `z.string()` in **five** places with three different nullabilities, when it is a `ReleaseCategory` enum with twelve values. Normalising all five to `z.nativeEnum` is the right change and wants its own PR — folding it in here would churn stellar-ui's vendored spec across unrelated sections for a reason that has nothing to do with collages.

- **`RequestBountyEntry` required a `user` that five of the eight request routes never send, and `Request.artists` was typed `unknown`** ([#474](https://github.com/orphic-inc/stellar-api/issues/474) slice 7, corrected) — found the same way as the two wiki corrections, by diffing stellar-ui's hand-written `requestApi` types against the registered components before binding them, and **for the third time the UI's version was the accurate one**: its `RequestBounty.user` was already optional. The bounty relation is included two different ways. The detail route, `POST /requests/{id}/bounty` and `GET /requests/{id}/bounty-history` pull the pledger (`bounties: { include: { user } }`); the **list, create, update, fill and unfill** echoes use a bare `bounties: true` and carry no `user` at all. So the component promised a field most of its uses omit. `user` is now optional on the shared shape, and the two responses that **do** guarantee it — bounty-history, and `RequestDetail`'s own bounties — use a new `RequestBountyEntryWithUser` rather than making every client null-check a field those responses always carry. `artists` is now `RequestArtistRef` instead of `z.array(z.unknown())`: the join row, with the artist itself **optional**, because create echoes bare `artists: true` rows while the detail route includes the artist. A bare `Artist` row is exactly the three required fields of the existing `Artist` component — everything else on that component is a relation include this join never asks for. `filledContribution` is deliberately left `unknown`: only the detail route includes it, it pulls a whole `Contribution` plus its release and uploader, and guessing at that shape is precisely how this section went wrong the first time.

**One generator trap is recorded in the source, because it is silent and it bit here.** `RequestBountyEntryWithUser` is spelled out rather than written as `RequestBountyEntry.extend({ user: ... })`. An `.extend()` that only **tightens** a field the base already declares emits an `allOf` branch with an empty property set, and `openapi-typescript` renders that as **`Base & Record<string, never>`** — the requirement is silently lost and the intersection is actively hostile. Extending is correct when it **adds** properties, which is what `RequestDetail` and the new wiki components do; it does not work for narrowing one. Checked by generating the client against the spec before committing, which is now the habit.

- **One `WikiPage` component described three different projections, and `WikiCompare` declared bodies nullable that a 200 never carries** ([#474](https://github.com/orphic-inc/stellar-api/issues/474) slice 5, corrected again) — found the same way as the entry below, by diffing stellar-ui's hand-written types against the registered component before binding them, and again **the UI was right and the contract was wrong**. `routes/api/wiki.ts` projects three shapes, not one: `PAGE_SELECT` for the list, `PAGE_WITH_BODY_SELECT` for the write echoes, and that row through `withBodyHtml()` for the two direct page reads. Collapsing them into a single schema made **`body` required on `GET /wiki`, which cannot serve it** — the list projection has no `body` column — and made **`bodyHtml` optional on the two reads that always carry it**, so a UI bound to the contract had to null-check a field that is guaranteed and could read one that is never sent. The component is now split into `WikiPageSummary` (the list rows), `WikiPage` (summary + raw BBCode; what create, update and rollback echo, and they pass no `bodyHtml` because they return the select directly) and `WikiPageRendered` (the two direct reads, `bodyHtml` guaranteed, `deletedAt` still optional because only the by-alias route projects it). Separately, `WikiCompare` typed `old.body` and `new.body` as nullable, but the handler answers **404 `Revision N not found`** when either resolves to null, so a 200 always carries strings — the nullability described a response the route cannot produce.

- **The registered `WikiPage` shape was wrong in three ways, and two wiki reads documented the wrong status code** ([#474](https://github.com/orphic-inc/stellar-api/issues/474) slice 5, corrected) — found while migrating stellar-ui's `wikiApi` onto the contract, where the UI's **hand-written types turned out to be more accurate than the registered component**. The component had been derived from the Prisma model; the routes actually project `PAGE_SELECT`, which **includes `author` and `aliases`** — both absent from the registration — and **does not select `deletedAt`**, which the registration claimed was always present. `deletedAt` is now optional, because the by-alias route alone projects it (it selects the column to reject a deleted page, then returns the row whole). **The status codes were also described backwards for two routes:** `GET /wiki/{id}` and `GET /wiki/by-alias/{alias}` answer **403** when a page is above the caller's read level — they confirm the page exists and say the rank is insufficient — while only the three _history_ reads (revisions, revision content, compare) answer 404 for the same condition. Slice 5 registered a uniform 404 non-confirmation across all five, which described a design the router does not have. The router's inconsistency is real and is now documented as such rather than smoothed over.

- **`POST /staff-inbox/tickets/{id}/reply` documented a 403 it never sends, and omitted the 404 it does** — the handler deliberately masks another member's ticket as **not-found rather than forbidden**, so the endpoint does not confirm that someone else's ticket exists; the registration claimed the opposite. Its `201` also returned a message body with no schema, now the new `StaffInboxMessage` component. Found while re-checking the previous entry's claim with a stricter query: the earlier detector asked whether a registration declared _any_ response schema, so a block with a schema'd `404` and a bare `201` passed it. Checking **each response** rather than each registration is the correct test, and by it the document now has **zero** body-bearing 2xx responses without a schema.

- **The five request operations that returned a body without describing it now describe it — and the `Request` shape they describe was wrong** ([#474](https://github.com/orphic-inc/stellar-api/issues/474)) — `GET /requests`, `POST /requests`, `GET /requests/{id}`, `POST /requests/{id}/bounty` and `POST /requests/{id}/fill` each declared a bare `200: { description: 'Success' }` with no schema. They were **all but one** of the schema-less body responses left in the document; the other `204`s correctly have no body. (The stray, `POST /staff-inbox/tickets/{id}/reply`, was missed because the detector asked whether a registration declared _any_ response schema rather than checking each response — it is fixed in the entry below.) So the requests router was the single place where the contract said an endpoint returns something without saying what — exactly the gap that leaves stellar-ui hand-writing types (ui[#277](https://github.com/orphic-inc/stellar-ui/issues/277)). **Writing them exposed an error in the `Request` component added earlier in this release:** it had been derived from the Prisma model, but every request-returning route answers with `serializeRequest(...)`, which sums the BigInt bounties into a `totalBounty` **string**, attaches `_count.bounties`, and returns relations only when the query included them — and which does **not** carry `voteCount`. `voteCount` and `votes` are added by the detail route alone, so they now live on a separate `RequestDetail`, and `GET /requests/{id}` is the only operation that returns it. Registering the fill route also turned up a **409** that inference had missed: losing the race when another submission fills the request first, distinct from the 400s for an ineligible contribution and the 403 for filling with someone else's.

- **Four registry paths described `/api/api/requests`** ([#474](https://github.com/orphic-inc/stellar-api/issues/474)) — `/requests`, `/requests/{id}`, `/requests/{id}/bounty` and `/requests/{id}/fill` were registered carrying an `/api` prefix that the other 199 paths correctly omit, and since the spec declares `/api` as the server base, they doubled it. They were also the _only_ registrations for that router, so there were no unprefixed duplicates masking it, and the five operations behind them read as unregistered in any audit while a differently-shaped path existed — which is what made the first pass at counting this mis-score. Nothing downstream breaks: `requestApi` is one of stellar-ui's hand-typed services (ui[#277](https://github.com/orphic-inc/stellar-ui/issues/277)), so it writes those URLs itself and never consumed the spec for them.

## [0.9.0] — 2026-08-31

### Added

- **Private-community announces now carry a routing target** — the first stellar-side slice of [#328](https://github.com/orphic-inc/stellar-api/issues/328) ([ADR-0030](docs/adr/0030-private-community-announce-delivery.md) Decision 3). `POST /irc/announce` gains an optional `target: { visibility, community }` derived from the contribution's community `announceVisibility`, so korin can route a private community's line to its gated `#c-<id>` channel instead of the `#announce` firehose. The identifier is the **numeric `Community.id`**, never a name or slug, so the channel survives a community rename; `channel?` stays in the wire contract as a forward-compat slot and is deliberately not sent, because korin derives it and stellar has no field to fill it from. **The extension is backward-compatible by omission:** a public community, or a contribution with no community at all, sends no `target` key — not `target: null` — so its push body is byte-identical to the pre-ADR-0030 one, and korin's existing handling is untouched. Note the wire field stays `visibility` while the stellar column is `announceVisibility`: only the column was renamed, and it is named for what it gates because **this flag is routing only and must never enter an access check** ([ADR-0015](docs/adr/0015-verified-irc-nick-link.md), Golden Rule 3) — a `PRIVATE` community with open registration stays readable by anyone, and the gated channel controls who _sees the line_, never who may download.

- **Private communities project their member set to korin as an IRC channel ACL** — the reconcile half of [#328](https://github.com/orphic-inc/stellar-api/issues/328) ([ADR-0030](docs/adr/0030-private-community-announce-delivery.md) Decision 4). A new `membershipJob` walks every `PRIVATE` community on the `KORIN_POLL_INTERVAL_MS` cadence and pushes its complete eligible **verified**-nick set to korin's `POST /irc/membership`, keyed by the numeric `Community.id` so the derived `#c-<id>` channel survives a rename. korin overwrites its ACL from each projection — a **disposable materialized view, replaced and never diffed**, so it self-heals across a korin restart with no reseed protocol. **Full sets rather than deltas, deliberately:** membership here is _derived_ from roughly eight scattered mutation points (member/curator/contributor add and remove, leader change, nick verify and unverify, disable/ban, a visibility flip) with no single choke-point to instrument, so a full replace has nothing to miss where per-seam deltas would have eight places to forget. An **empty set is projected verbatim** rather than skipped — "nobody may see this" is a legitimate state, and skipping would leave korin holding an ACL stellar believes it has replaced. Eligibility composes the existing `communityRoleUnion` (consumer ∪ contributor ∪ curator) rather than restating its arms, and adds two filters: only `ircNick` — which by construction holds a _verified_ nick, never an unproven `pendingIrcNick` claim ([ADR-0015](docs/adr/0015-verified-irc-nick-link.md)) — and not disabled accounts. Site staff are **not** included: `communities_manage` is an Axis-2 global capability, not membership in every private community. The job is dedicated rather than folded into `announceJob`, and unlike that job it **holds no cursor** — a full-set projection is idempotent and order-free, so one community's failure never stalls the rest and everything simply retries next tick. Staleness is costless by construction: this gates announcement _visibility only, never a download_ (Golden Rule 3), so a late tick means a removed member may see that a release _exists_ for at most one interval.

- **A private community's channel ACL is freshened immediately before its announce goes out** — the piggyback that completes [#328](https://github.com/orphic-inc/stellar-api/issues/328)'s stellar side ([ADR-0030](docs/adr/0030-private-community-announce-delivery.md) Decision 4). Without it, the first line after a membership change would route into a channel whose ACL is up to one `KORIN_POLL_INTERVAL_MS` tick stale — the new member misses exactly the announce that prompted them to join. `runAnnounceCycle` now projects a private community's membership just before routing its line. **It is strictly best-effort and never gates the announce:** projection and delivery are independent failure domains sharing one ordered cursor, so holding that cursor for a membership failure would let a single `/irc/membership` outage wedge the entire ordered firehose — public communities included — to protect a property that is costless to lose, since a stale ACL delays _visibility only, never a download_ (Golden Rule 3). A failed projection is logged and the line goes out regardless; the periodic reconcile self-heals the ACL on the next tick. The guard is a catch-all rather than a check of the return value alone: the projection returns `false` for a failed push, but its DB reads can still throw, and an exception escaping would abort the cycle — gating the announce by the back door. Which items count as private is decided by the same `announceTarget` that builds the routing target, so the piggyback and the routing cannot disagree.

- **Avatars can be self-hosted in the asset store, and both avatar write paths are now scheme-constrained** — `avatar` was `z.string().url()` on `PUT /api/profile/me` and, until this change, a bare `z.string()` with no URL check at all on `PUT /api/users/settings`. [#361](https://github.com/orphic-inc/stellar-api/issues/361) named only the first: an avatar renders to every viewer of a member's profile and posts, so an arbitrary remote URL collects IP, user agent and visit timing for every member who views that content — no CSS, no adoption, no consent. A boundary on one of two doors is not a boundary, and the second door was the wider one. `AssetKind` gains `Avatar` and `POST /api/asset` gains the `?kind=` param its own comment had reserved for "the day a second kind is uploadable", so a member can store an avatar as `/api/asset/<sha256>` under the existing rank quota, magic-byte validation and image-only rule — the param labels the bytes and gates nothing. Both write paths, plus the donor `customIcon`/`secondAvatar` perks that render on the same surfaces from the same bare `.url()`, now accept only https or a content address. **This narrows [#361](https://github.com/orphic-inc/stellar-api/issues/361) rather than closing it, and the PR says so:** an https remote avatar still discloses IP and timing, because closing that needs the CSP's `img-src`, which [ADR-0031](docs/adr/0031-injected-css-threat-model.md) §6 deliberately keeps open. That deferral is re-filed on a corrected footing — ADR-0031 costed `img-src 'self'` as "breaks every remote avatar", but BBCode `[img]` (`lib/bbcode/render.ts`) renders an arbitrary remote image into every forum post, so the cut was always larger than the avatar-shaped framing implied ([#457](https://github.com/orphic-inc/stellar-api/issues/457)). The sweep is the sharp edge here: `collectReferencedHashes` reads `User.avatar` **and** `Profile.avatar` (two columns, written by different routes, reconciled by nothing), because an avatar the sweep cannot see is collected 24 hours after upload and the profile 404s. `prisma/scripts/backfill-clear-insecure-avatars.ts` clears already-stored `http:`/`ftp:` values by hand, following `backfill-remove-gravatar-avatars.ts` — deliberately not a migration, because nulling an avatar is a visible change to someone else's account. ([#396](https://github.com/orphic-inc/stellar-api/issues/396), [#361](https://github.com/orphic-inc/stellar-api/issues/361))

- **Authors can edit and withdraw their stylesheets** — the authored-stylesheet surface had no update or delete route, while two shipped comments already claimed otherwise (`routes/api/stylesheet.ts` justified `Cache-Control: no-cache` with "Sheets are mutable (authors edit in place)", and `getAuthorStylesheetById`'s docstring called itself "the edit-path read"), and [#350](https://github.com/orphic-inc/stellar-api/issues/350) had decided that adoption tracks the author's edits — all statements about a path that did not exist. The quota compounded it: [#146](https://github.com/orphic-inc/stellar-api/issues/146) enforces registry spaces with no way to free one, a one-way ratchet. `PUT /api/stylesheet/author-stylesheet/:id` edits in place, author-scoped, through the same `assertSafeSource` call site as create — which was written anticipating exactly this ("shared by create and any future edit path"), so an edit cannot smuggle past the ADR-0031 boundary a create is held to. `DELETE` withdraws softly via a new nullable `deletedAt`. **The read-path asymmetry is the whole design:** the list and its total, the quota count, the edit-path read and adoption all filter withdrawn sheets, while `getAuthorStylesheetCss` alone does not — an author freeing a space must not change the site under someone who adopted their sheet. Hard delete was rejected because an adopter's active slot points at the row; refuse-while-adopted because it makes withdrawal a permission other members hold over you. The `CRS_STYLESHEET_ADOPTION` ledger is deliberately untouched: those adoptions were earned, and PRD-03's marginal tier table already eases an author's score down as live counts fall rather than re-rating history. ([#368](https://github.com/orphic-inc/stellar-api/issues/368), [ADR-0032](docs/adr/0032-authored-stylesheet-member-lifecycle.md) §2/§3)

- **CI now requires a changelog entry from any PR that touches shipping code** — `npm run version:check` compares the top **dated** `## [X.Y.Z]` heading against the manifest and never inspects `[Unreleased]`, so work landing between cuts accumulated there unrecorded with nothing to report it: `[Unreleased]` documented 1 of the 21 commits since v0.8.1 until [#384](https://github.com/orphic-inc/stellar-api/pull/384) backfilled it by hand. That was cosmetic until the `release` job began publishing the tag's section verbatim as the GitHub Release notes — an unreconciled changelog is now thin public notes, permanently, on the surface people see first. A new `Changelog entry` step in the existing (already-required) `test` job fails a pull request that changes `src/`, `prisma/` or `.github/workflows/` without also updating `CHANGELOG.md`; `no-changelog` on the PR is the escape hatch, and the `pull_request` trigger gained `labeled`/`unlabeled` so applying it re-evaluates without a manual re-run. The rule is a per-PR file check rather than the commit-range reconciliation the issue first proposed, because two measurements against real history rule that out: entries are not 1:1 with commits (17 bullets for 13 commits at the time of writing — one commit produced two bullets, one bullet covered four commits), so no count-based threshold is sound; and entries get written in batches days later (the SSRF and nodemailer bullets both arrived via an unrelated `docs(adr-0034)` commit), which is the very lag the gate exists to close. Logic lives in a pure `lib/changelogGate.ts` with a `src/scripts/check-changelog.ts` wrapper, mirroring the `versionConsistency` split from [#79](https://github.com/orphic-inc/stellar-api/issues/79); `npm run changelog:check` runs the same rule locally over committed, working-tree and untracked files. ([#386](https://github.com/orphic-inc/stellar-api/issues/386))

### Changed

- **The integration suite no longer issues ~23,000 `TRUNCATE` statements per CI run** — `truncateAll` runs in `beforeEach` for every integration test and looped over `pg_tables` issuing one `TRUNCATE` per table: ~126 tables x ~185 tests, `--runInBand`, so strictly serial. That is an almost purely I/O-bound workload — relation-file truncation and fsync — which is why a contended runner did not slow the suite a little but inflated it **4-16x across every suite at once**, one 68-minute run against a 6-11 minute baseline. The suite that failed was never the cause: `staffLists` was simply the first `beforeEach` to cross the 60s hook ceiling, and [#165](https://github.com/orphic-inc/stellar-api/issues/165) was this same shape in June, "fixed" by raising the timeout from 30s to 60s — which only changed which suite trips first. It is now a single batched `TRUNCATE a, b, c … RESTART IDENTITY CASCADE`: one lock acquisition, one pass. The loop it replaces was already documented as a non-load-bearing leftover from the [#424](https://github.com/orphic-inc/stellar-api/issues/424) deadlock work — it ran inside one `DO $$ … $$` block, so it held every `ACCESS EXCLUSIVE` lock until commit exactly like the batched form, and if anything widened the deadlock window by acquiring locks one at a time. `drainBackgroundTasks` is, and remains, the actual deadlock fix.

- **CI's PostgreSQL keeps its data directory on tmpfs.** The CI database is created and thrown away inside one job, so durability there buys nothing while costing every fsync the truncate-heavy suite generates. `--tmpfs /var/lib/postgresql/data` on both the `test` and `integration` service containers removes the disk-I/O sensitivity that made runner contention so violent — the variance, not just the mean, is the thing this targets.

- **`CHANGELOG.md` merges by union.** Every PR touching shipping code must edit it (the [#386](https://github.com/orphic-inc/stellar-api/issues/386) gate) and entries are appended at the top, so concurrent PRs collide there by construction — always as "both sides added a bullet", never a real disagreement. A new `.gitattributes` marks the file `merge=union`, which keeps both sides instead of raising a conflict. That removes the rebase-an-already-green-PR tax, and closes a sharper hazard: a hand-resolved conflict can silently drop the _other_ PR's entry, which the #386 gate cannot detect — it checks that a PR touches the file, not that it preserved someone else's bullet — and the `release` job would then publish the incomplete section as Release notes, permanently. Union merge can interleave two bullets in an unintended order, which is worth a glance at review; it cannot lose one.

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

- **The changelog gate now checks that a PR kept everyone else's `[Unreleased]` entries, not just that it added its own** ([#386](https://github.com/orphic-inc/stellar-api/issues/386)) — the gate asked one question, "did this PR touch `CHANGELOG.md`?", and a PR that adds its own bullet while deleting someone else's answers it yes. That is not hypothetical: a branch updated via GitHub's "Update branch" button carried a merge commit that dropped [#456](https://github.com/orphic-inc/stellar-api/pull/456)'s entry, the gate passed, and only a rebase brought it back. Because `release` publishes `[Unreleased]` verbatim as the Release notes, a bullet lost there is lost from the release record permanently. `merge=union` narrows this — a _conflicting_ region now resolves by keeping both sides — but a deletion that does not conflict is still just a deletion. The gate grows a second, independent check: **every entry in the base branch's `[Unreleased]` must still appear somewhere in the head's `CHANGELOG.md`.** "Somewhere in the file" is doing deliberate work — a release cut renames the section and a heading tidy-up merges the duplicates `merge=union` accumulates, and both must pass without an exemption, or the check gets switched off and the hole reopens. Rewording a bullet below its bold lead is free for the same reason. The comparison is against the **merge base**, not the base branch tip: entries added to `main` after a branch diverged were never on that branch, so their absence is not a deletion, and comparing against the tip would fail every branch that has not just been rebased — the long-lived Renovate ones first. The #458 shape is still caught, because an "Update branch" merge commit makes `main` an ancestor of the head, so the merge base _is_ the tip and the dropped entry is unambiguously a deletion. That base comes from the API in CI (the checkout is shallow, so neither commit is in the local object store — the same constraint the file list already works around) and from `git merge-base origin/main HEAD` locally; it is passed by path, never a second pipe, because this script has broken twice on fd 0 already. In stdin mode a missing base file is fatal rather than skipped: a check that quietly does not run is the failure mode one level up.

- **`npm run changelog:check` no longer hangs forever, and no longer answers a question nobody asked** — the local half of the [#386](https://github.com/orphic-inc/stellar-api/issues/386) gate read `readFileSync(0)` unconditionally and treated an empty result as "nothing was piped in". That cannot work: the call blocks until the writer closes the pipe, and "nothing is on stdin" is indistinguishable from "the writer has not written yet" until it does. Any caller that inherits an open stdin it never writes to and never closes — an editor task runner, a CI shell, an agent harness — blocked indefinitely; one invocation was found still parked after **fifteen hours**, at 0% CPU, holding a process slot. Its own docstring claimed the read returned `''` "when stdin is a TTY", which was never true and never implemented: reading a TTY blocks on keyboard input until Ctrl-D, and nothing in the file checked `isTTY`. The caller now **states** which input path it wants instead of the script inferring it from the state of fd 0: `CHANGELOG_STDIN=1` reads the pipe (CI sets it), and its absence diffs the working tree without touching fd 0 at all. Requesting stdin mode from a terminal now exits with an explanation rather than looking like a hang.

  **Deciding to read fd 0 and successfully reading it turned out to be two separate problems, and this fix went red twice before clearing both.** The first attempt made the switch an argv flag: `npm run x --silent -- --stdin` forwards the flag under npm 10 and _drops_ it under npm 11, and CI runs Node 24 (npm 11) while a dev box may still be on Node 22 (npm 10) — so it passed every local check and failed on CI. It is now an env var, set by the shell before npm and parsed by no one, and so cannot diverge that way; `--stdin` is still honoured where npm forwards it. The second was subtler and **not** version-dependent: the TTY guard read `process.stdin.isTTY`, and that getter _constructs_ the stream and puts fd 0 into non-blocking mode, after which `readFileSync(0)` throws `EAGAIN` whenever the pipe has no data buffered yet. Whether it broke was purely a race against the writer — a local `printf` fills the pipe instantly and wins; CI's `gh api --paginate` goes to the network first and loses. The guard is now `tty.isatty(0)`, a bare syscall that answers the same question without creating a stream. **The failure path mattered as much as the bug:** the `EAGAIN` was swallowed to `''` and an empty result fell back to git, so on CI the gate died on an unresolvable `origin/main...HEAD` (the runner's checkout is shallow) while _the same fallback run locally simply passed_, silently grading the working tree instead of the piped list. Stdin mode now reads the pipe or exits non-zero, and never re-routes itself to a different input. Covered by `src/scripts/check-changelog.spec.ts`, whose deliberately **slow** writer is the whole point — a fast one passes with the bug present, which is how it shipped twice.

- **The stylesheet registry can no longer be left with no default** — `getDefaultStylesheetName` ended `?? 'sublime'`, and [#376](https://github.com/orphic-inc/stellar-api/issues/376) had assessed that literal as harmless cleanup on the grounds that the cross-repo half of the drift was already gone (stellar-ui #196 stopped reading the stylesheet _name_). What had not been checked was whether the fallback was reachable. It was: `stylesheets_one_default` is a partial unique index enforcing _at most_ one default, and nothing enforced _at least_ one — `updateStylesheet` only special-cased `isDefault: true`, so `PUT /api/stylesheet/:id` with `isDefault: false` on the current default fell through to a plain update and left the registry with none. `deleteStylesheet` refuses only while a sheet **is** default, so the now-undefaulted `sublime` became deletable, after which every newly created user was handed a `siteAppearance` naming a stylesheet that did not exist. The write path now refuses to unset the last default (`set another as default instead` — mirroring the delete guard; promotion is how the default moves), which makes the fallback unreachable, so it is replaced by a thrown error rather than a literal: if it ever fires the invariant is broken and the registry is what needs fixing, not the default. **No client is affected** — stellar-ui's `StylesheetManager` only ever sends `isDefault: true` and hides the control on the row that already is default, so the API was permitting something no consumer does. The `user_settings.siteAppearance` column default is deliberately left alone: it is a different axis, reached only by inserts that omit the column, and all three creation paths pass an explicit value. ([#376](https://github.com/orphic-inc/stellar-api/issues/376))

- **`/install` no longer bootstraps a site with dangling theme imagery** — `POST /api/install` did not call `seedAll()`; it re-implemented the seed sequence inline, and the two copies had already drifted. The route's copy omitted `seedAssetFixtures`, so a site brought up through the web installer — rather than `db:seed` or the container boot path — got the built-in stylesheet fixtures without the binary assets they reference, leaving the asset-bearing `proton` theme ([#341](https://github.com/orphic-inc/stellar-api/issues/341)) serving permanently dangling `/api/asset/<sha256>` targets. `seedAll` documents why its ordering matters (theme imagery before the stylesheets referencing it; the System user before the fixtures it owns), but a second hand-maintained list cannot inherit a constraint it does not state, which is the actual defect — the omission was the symptom. The route now delegates to `seedAll(prisma)`, which is safe here precisely because it creates no real users and does not stamp `SiteSettings.installedAt`, the two properties that keep `/install` available and required. `seedDefaultCommunity` stays in the route: it needs the SysOp the route mints. A new test pins the install-path half of the claim end to end — every `/api/asset/<hash>` the shipped fixture CSS points at is a hash a fresh install stored. ([#390](https://github.com/orphic-inc/stellar-api/issues/390))

- **A new ruleset seeder can no longer suppress the Golden Rules** — `seedGoldenRules` guarded on a table-wide `client.rule.count()`, making it a no-op once **any** `Rule` row existed rather than once the _golden_ rows existed. It is currently the only rule seeder, so nothing hit it; PRD-05 descent target #3 specs two more (`irc.conduct`, `interview.conduct`), and either one seeding first on a fresh database would have silently suppressed the entire canon — the site would come up with those rules and no Golden Rules, and nothing would report it. The existing drift-guard cannot catch this class of bug: it compares `CODE_OF_CONDUCT.md` to the in-code table and never reads the database, so both would agree perfectly while the `rules` table sat empty of `golden.*` rows. The guard is now namespaced to `code startsWith 'golden.'`, which makes it mean what its name implies and stays correct however seeders are ordered later; each future ruleset guards its own codes. A companion test pins the invariant the guard now depends on — every rule code sits under that namespace — since a code outside it would be invisible to its own guard and collide on re-seed. ([#388](https://github.com/orphic-inc/stellar-api/issues/388))

- **A donor's extra registry spaces and collage slots are now actually granted** — `toAuthUser` advertised `personalCollageLimit` and `authorStylesheetLimit` as the maximum across a member's primary **and** secondary ranks, while both enforcement sites consulted the primary rank alone. Since PRD-03's "$tylesheets — donor-added slots" models the perk _as_ a secondary rank, the promised feature read as granted and enforced as absent: a donor was shown `5`, allowed `3`, and refused with `Author stylesheet limit reached (3)` — a number they had never been told. The same `Math.max` also inverted the `0 = unlimited` semantic these two columns carry (the one `UserRank.assetLimit` documents itself as the deliberate opposite of), so an unlimited primary rank plus a donor secondary of `5` advertised `5` — a perk that _lowered_ a ceiling. Both halves now resolve through one `resolveRankQuota` in `lib/userRankAccess.ts`, the module that already merges primary and secondary ranks: `0` anywhere in the set means unlimited, otherwise the highest cap applies, so a secondary rank can only ever raise a ceiling. `personalCollageLimit` was fixed in the same change rather than left as a known-identical bug on the adjacent line — it is the precedent `createAuthorStylesheet` was written to mirror, and leaving it would have made that comment a lie. **The wire contract is unchanged**: unlimited still serializes as `0`, as it always has; what changed is which number gets sent. `createAuthorStylesheet` also drops its `userRankId` parameter, which named the primary rank — the exact thing that stopped being consulted — and its docstring, which recorded the now-reversed decision as deliberate. ([#369](https://github.com/orphic-inc/stellar-api/issues/369), [ADR-0032](docs/adr/0032-authored-stylesheet-member-lifecycle.md) §4)

- **The E2E fixture seeder now plants a release, so `release.spec` can actually pass** — `src/scripts/seed-e2e-users.ts` created the accounts and the invite subtree but no content, and stellar-ui's `e2e/release.spec.ts` needs one community holding one release. Its own assertion said so — _"No releases found — seed at least one release in the test community"_ — and the failure was structural rather than flaky: P-06 failed on the missing release, and P-07a/P-07b cascaded because both derive their target URL from the release P-06 discovers. The 0.8.1 live-box pass against a real container stack was 14 passed / 14 failed, and three of those failures were this, with no app defect involved. A new `modules/e2eFixtures.ts` seeds one artist, one release in the default community (with the `Main` credit the browse table's artist column is derived from, and the edition `Contribution.editionId` requires), and one contribution owned by the existing `e2e_alpha` fixture. The contribution is not optional garnish: P-07b reports a dead link on an existing contribution and calls `test.skip()` when there is none, so a release-only fixture would have left it permanently skipped — the quiet version of the red-by-default problem this fixes. It lives in `modules/` and takes a `PrismaClient` like every other seeder here (`seedRanks`, `seedGoldenRules`, `seedAll`), which is what lets an integration test drive it against a real database; the production refusal (`NODE_ENV=production` without `ALLOW_E2E_SEED`) stays on the CLI entry point, and the module is inert on import. ([#339](https://github.com/orphic-inc/stellar-api/issues/339))

- **Report deep links no longer depend on a UI redirect shim** — `modules/reports.ts` minted every report `sourceUrl` with the `/private/` prefix that the 0.8.x flattening removed from stellar-ui's route model, across fourteen sites covering users, releases, forum topics, collages, artists, requests and communities. Nothing was visibly broken, because stellar-ui's `LegacyPrivateRedirect` catches them — but every link paid an extra client-side hop, and all of them break the moment that shim is retired. The prefix is gone, and the route shapes are now named once each rather than spelled out inline: the release path alone appeared four times, and artists, collages and forum topics twice each, which is how the prefix survived the flattening in the first place. Parity is exact rather than assumed — the shim is a literal `pathname.replace(/^\/private(?=\/|$)/, '')`, so the post-fix URL is the one users already reach through it, and `lib/bbcode/render.ts` has been building four of these same routes prefix-free all along. **The line that could not wait for a shim** is the resolution PM: `View your report: /private/reports/<id>` is plain text baked into a delivered message, so no redirect rescues it and already-sent PMs keep the stale path permanently. The nine spec assertions that encoded the old strings move in the same change — they are the guard that made this impossible to drop silently, and all nine failed against the fix before being updated. ([#338](https://github.com/orphic-inc/stellar-api/issues/338))

### Security

- **The link checker no longer follows user-supplied URLs into private address space** — `linkHealth.checkUrl` probes `Contribution.downloadUrl`, which is whatever a member typed into the submission form, and it passed that string straight to `fetch` with `redirect: 'follow'`. `z.string().url()` only proves the string parses, and the approved-domains gate in the contribution routes is conditional (`if (settings.approvedDomains.length > 0)`), so a default install applied no host restriction at all — making the probe a server-side request forgery primitive against `169.254.169.254`, `127.0.0.1:5432`, and anything else reachable from the API host. The probe is blind, but a PASS/WARN/FAIL still distinguishes an open port from a closed one, which is a working internal port scanner. A new `lib/ssrfGuard.ts` now decides at the egress point: `http`/`https` only, and the host — literal address or every address a name resolves to — must sit outside loopback, RFC1918, carrier-grade NAT, link-local (which carries the cloud metadata endpoints), multicast and reserved space. Redirects are resolved by hand and re-checked at **every** hop, because an allowlisted host is otherwise free to answer with a 302 to a link-local address that the server then dials under its own network identity. A refused URL records `FAIL` without opening a socket. Found by Codacy's Semgrep; see the [ADR-0034 amendment](docs/adr/0034-eslint-9-flat-config-and-the-import-plugin-ceiling.md#amendment-2026-08-30-the-open-question-answered).

- **`nodemailer` 8 → 9** — closes GHSA-p6gq-j5cr-w38f (High), where a message-level `raw` option bypasses `disableFileAccess`/`disableUrlAccess` and enables arbitrary file read and full-response SSRF in the delivered message. This repo never passes `raw` — `sendInviteEmail`/`sendRecoveryEmail` send `from`/`to`/`subject`/`text` only — so exposure was nil, but the dependency is a direct production one and the fixed line is the one to be on. `@types/nodemailer` stays at `^8.0.0`; DefinitelyTyped has published no 9.x, and the surface this repo uses (`createTransport`, `sendMail`) is unchanged across the major.

- **The unused direct `jsdom` dependency is removed, taking eleven `undici` CVEs with it** — `jsdom@^29.0.2` sat in `dependencies` but nothing imported it: every mention of jsdom in `src` is a _comment_ about `isomorphic-dompurify` pulling it in transitively, and Jest runs `testEnvironment: 'node'`. It was, however, the only thing resolving `undici@7.25.0` — eleven CVEs including request smuggling, cache poisoning, cookie-attribute injection and unbounded WebSocket memory growth. `isomorphic-dompurify` carries its own nested `jsdom@30.0.1` → `undici@8.10.0`, which is unaffected, so the install was also carrying two jsdom trees. Removing the direct dependency (and the equally unreferenced `@types/jsdom`) drops `undici@7` from the tree entirely. The sanitizer — the XSS boundary — was smoke-tested directly afterwards and still strips `onerror` and `<script>`.

- **`deepmerge-ts` pinned to ^8 via `overrides`** — CVE-2026-40345 (High, stack exhaustion on recursive object graphs) reaches the production tree through `prisma` → `@prisma/config`, and `prisma` is deliberately a runtime dependency here rather than a devDependency so the container entrypoint can run `prisma migrate deploy`. No prisma release fixes it: even `@prisma/config@7.10.0` still pins `deepmerge-ts@7.1.5`, so an override is the only lever. Real exposure was nil — `@prisma/config` reaches `deepmerge` only in `loadConfigTsOrJs`, which merges a `prisma.config.*` file, and this repo has none — but the finding is legitimate and will recur as soon as one is added (Prisma 7 deprecates the `package.json#prisma` block in favour of exactly that file). v8 keeps the `deepmerge` named export and its merge semantics unchanged, which is what `@prisma/config` hands to c12 as `merger`; `prisma validate` and `prisma generate` both verified under the override. `npm audit` now reports zero vulnerabilities.

- **The remaining dev-only advisories are cleared — `npm audit` is now zero across the whole tree** — thirteen advisories sat in the development dependencies (`@babel/core` arbitrary file read via `sourceMappingURL`, five `brace-expansion` ReDoS/DoS entries, `braces` resource exhaustion, `diff` DoS in `parsePatch`/`applyPatch`, and `extract-zip` unvalidated symlink path traversal reaching in through `puppeteer`). None was ever reported by Codacy, whose Trivy scan covers the production tree — which was already clean — so this closes a gap the dashboard could not see. Applied with a plain `npm audit fix`: `package.json` is untouched, so no declared range moved, and **no production package changed version**. Four majors move, all confined to the ERD toolchain (`puppeteer` 24 → 25, `@puppeteer/browsers` 2 → 3, plus `puppeteer-core` and `chromium-bidi`), which reaches the repo only through `prisma-erd-generator` → `@mermaid-js/mermaid-cli`; `npm run db:erd` was run against the new tree and regenerates `docs/erd.md` byte-identically. The rest is patch-level `@babel/*`, `mermaid`, and browser-target data. Deliberately kept as its own change rather than folded into the security work above, because [ADR-0034](docs/adr/0034-eslint-9-flat-config-and-the-import-plugin-ceiling.md) records [#357](https://github.com/orphic-inc/stellar-api/pull/357) — a lockfile refresh that silently carried prettier and TypeScript across minors and broke `prettier --check` and `tsc`. `typescript`, `prettier`, `eslint` and `jest` are all confirmed unmoved here.

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

[Unreleased]: https://github.com/orphic-inc/stellar-api/compare/v0.9.3...HEAD
[0.9.3]: https://github.com/orphic-inc/stellar-api/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/orphic-inc/stellar-api/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/orphic-inc/stellar-api/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/orphic-inc/stellar-api/compare/v0.8.3...v0.9.0
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
