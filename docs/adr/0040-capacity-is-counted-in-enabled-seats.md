# Capacity is counted in enabled seats

**Status: Accepted (2026-09-14).** Accepted as the gate on [#624](https://github.com/orphic-inc/stellar-api/issues/624), whose implementation follows this contract, the posture [ADR-0039](0039-invite-supply-is-class-based-accrual.md) took on #282. It records the decisions from the grill on that issue. They depend on one another, and no single call site can show that.

## Context

**`SiteSettings.maxUsers` was a promise nothing kept.** `modules/settings.ts` defaults it to 7000, `modules/stats.ts` reports it, `modules/statsHistory.ts` snapshots it, and the install checklist asks the operator to "set a launch-ready capacity limit". `registerUser` never read it, so a site configured for 500 members could register 5000.

[ADR-0039](0039-invite-supply-is-class-based-accrual.md) is what made this urgent. Before #282 nothing raised `inviteCount`, so the founding SysOp's 100 invites were the whole supply. The invite handout is now a faucet, and the only bound on the accounts it can create is `inviteCap` times the eligible members.

Four facts from the code decided the rest:

- **Three paths create an account.** They are `registerUser`, `POST /api/users` (staff, `users_edit`) and `/install`. One more, `POST /api/users/:id/enable` (staff, `users_disable`), brings a disabled account back. #279's `reactivation-confirm` opens a staff ticket and never flips `disabled` itself.
- **Users are never hard-deleted.** A count of rows only ever grows.
- **#279's dormancy sweep disables dormant accounts in bulk** ([ADR-0038](0038-inactivity-is-a-clock-not-a-timestamp.md)).
- **The repo's only quota check counts, then creates, with no lock.** That is `authorStylesheet.ts` against `authorStylesheetLimit`, and nothing in the codebase takes an advisory lock, sets an `isolationLevel` or selects `FOR UPDATE`.

## Decision

### 1. A seat is an enabled account

The seat count is `user.count({ where: { disabled: false } })`, defined once as `countSeats` in `modules/settings.ts`. `getSystemStats`'s `enabledUsers` reads through the same function. Disabling an account frees a seat and re-enabling it takes one back. The System user is `disabled`, so it never holds one. Staff accounts are enabled accounts and do hold seats.

Counting rows was rejected. The dormancy sweep exists largely to prune dead accounts, and under a row count pruning would free nothing: a capped site would fill up for good and stay full as its members went quiet. It would also make `maxUsers` mean "most registrations ever", which the checklist's "capacity limit" does not describe.

### 2. Only self-registration is capped

`registerUser` enforces the cap. `POST /api/users` and `POST /api/users/:id/enable` do not, and `/install` creates the very first account.

The cap exists to stop growth nobody decided on. A staff action is a decision, and both staff paths already write an audit row (`user.create`, `user.enabled`). A hard wall on re-enabling would stop a full site from reinstating a member the dormancy sweep disabled wrongly, or one who won an appeal. The member would pay for the site's growth, and staff would have to disable someone else to make room. An override flag was also considered and rejected. It would mean a contract change and ui work just to make staff confirm something the audit log already records.

The consequence is that enabled accounts **can** exceed `maxUsers`, by staff action. Registration then stays shut until enough accounts are disabled to bring the count back under the limit.

### 3. Registration is exact; everything else is best-effort

Inside `registerUser`'s existing interactive transaction, `pg_advisory_xact_lock` is taken first, then seats are counted, then the account is created. The order is the design. Under READ COMMITTED each statement sees rows committed before it began, so a caller that waited on the lock counts the seat its predecessor just took. A count taken before the lock would be shared by every concurrent caller, and each would see the same last free seat. The lock is transaction-scoped, so a commit or a rollback releases it and no path can leak it.

This is stricter than the existing quota precedent, and deliberately so. Decision 2 already makes the overall cap soft, but self-registration must never overshoot what the operator set. `authLimiter` alone would bound an overshoot per IP address, not per site.

Two other checks read the same count **without** the lock, because neither takes a seat:

- **`POST /profile/referral/create-invite` refuses early**, before it calls `createInvite`, which is where the invite is spent. A member of a full site keeps the invite rather than emailing it to someone registration will turn away.
- **`GET /api/install` reports `registrationFull`**, so the register page can say "full" before a visitor fills in the form. It is a boolean and never the counts, because the endpoint is anonymous, and it is always false while registration is `closed`.

`registerUser` takes `maxUsers` as a required option, just as it takes `registrationMode`. It does not read settings itself, and an omitted cap would be an unenforced one.

_(Extended 2026-09-15, by [#637](https://github.com/orphic-inc/stellar-api/issues/637) and [ADR-0043](0043-sending-an-invite-is-gated-on-the-inviter.md). The send's capacity check moved from the route into `createInvite`'s send gates, still before anything is written. It now refuses after the member's own gates, so a revoked member on a full site hears about the revoke. A permission to invite past capacity was considered and declined, keeping Decision 2's staff path as the only growth past the cap.)_

_(Amended 2026-09-20, by [#657](https://github.com/orphic-inc/stellar-api/issues/657). The bullet above ends "and it is always false while registration is `closed`". That is no longer true, and the condition is removed rather than narrowed. It was justified by the register page, which turned out not to need it: `Register.tsx` branches on `registrationStatus === 'closed'` **above** the line that reads `registrationFull`, so the closed wording already won and the api's condition bought nothing there. What it did buy was silence everywhere else — a staff "site is full" banner disappeared the moment registration closed, which is precisely when an operator is most likely to be looking at capacity. `registrationFull` now means enabled seats have reached `maxUsers`, full stop. A second field was considered and declined: two booleans describing one fact, with the api owning a branch the UI already makes.

Two consequences accepted with it. An anonymous caller now learns "at capacity" while closed, where it previously read `false` — one bit, and `/stats` is behind `requireAuth`, so `maxUsers` stays underivable; the old answer was simply wrong. And a closed site now runs the seat count on every `/install`, because the `&&` no longer short-circuits it — an open or invite site already paid that on every request, so this extends an existing cost rather than introducing one.

The meaning also moved **into** the contract, as a `.describe()` in `lib/openapi.ts`. It had only ever been a TypeScript comment, so `openapi.json` carried a bare boolean and a generated client explained nothing — which is how [stellar-ui#327](https://github.com/orphic-inc/stellar-ui/issues/327) inherited the blind spot in the first place.

**The converse gap is not closed.** Nothing in the invite send path reads `registrationStatus`: ADR-0043 §1's six gates do not include it, so on a closed **not-full** site a member still spends an invite that `registerUser` refuses before it reads the key. That is [#673](https://github.com/orphic-inc/stellar-api/issues/673), and this decision does not fix it. "Full" and "closed" are different facts in both directions; this amendment settles only the read side.)_

### 4. A full site answers `403`, and nothing is written

Both routes answer `403 { msg }`. That is a policy refusal, like `registration_closed`, which is already `403` on the same route. `503` was rejected: being full is a normal state of the site, not an outage, and it would page anyone monitoring 5xx rates. Registration refuses before its transaction writes anything, so a presented invite stays `pending`. Invite creation refuses before `createInvite` runs, so `inviteCount` is never decremented.

### 5. No mode switch, and no special value

Enforcement is live on deploy. #279 and #282 ship behind `off | dryRun | on` because each **writes** in bulk, and `dryRun` exists to check a predicate against real data before it acts. This change writes nothing; it only refuses. The predicate is `seats ≥ maxUsers`, which an operator can read off the homepage, and a wrong value is fixed with a settings edit, not a redeploy. A switch that defaulted to `off` would recreate #624 itself on every instance that never flipped it.

`maxUsers` keeps its `min(1)` in both the API schema and stellar-ui's settings page. "Closed" is already `registrationStatus: closed`, and an operator who wants no practical limit sets a large number. A `0 = unlimited` value was rejected. It would be one more meaning of `0` among the fields staff edit, next to `personalCollageLimit`'s `0 = unlimited` and the invite rates' `0 = none`.

## Consequences

**An instance whose enabled accounts already exceed `maxUsers` stops accepting registrations and invites on deploy.** That is the setting working as its checklist entry always described. The CHANGELOG carries it as an upgrade note.

The contract change is small. `POST /auth/register` and `POST /profile/referral/create-invite` get wider `403` descriptions, with no new status code, so the failure-coverage baseline does not move. `GET /install` gains the additive `registrationFull`.

stellar-ui owes two surfaces: a "full" state on the register page, and a banner in `ModBar` that cannot be dismissed while the site is full ([ui#327](https://github.com/orphic-inc/stellar-ui/issues/327)). The banner must not be a `setupChecklist` item. Those are dismissed permanently by id, so it would be silent the next time the site filled. A near-capacity warning was deliberately left out, because the homepage already shows max against enabled users.

The first advisory lock in the repo is proven by an integration test that registers concurrently for the last seat. A mocked Prisma can only show that the lock is taken before the count, not that it works.

Invite expiry is not enforced, and it is out of scope here. An invite refused at a full site stays usable until that is fixed ([#627](https://github.com/orphic-inc/stellar-api/issues/627)).
