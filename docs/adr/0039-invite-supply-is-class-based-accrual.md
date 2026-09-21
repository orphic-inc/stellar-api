# Invite supply is class-based accrual

**Status: Accepted (2026-09-11).** Accepted as the gate on [#282](https://github.com/orphic-inc/stellar-api/issues/282), whose implementation follows this contract rather than preceding it — the posture [ADR-0038](0038-inactivity-is-a-clock-not-a-timestamp.md) took on #279. It records the decisions taken while scoping #282, starting with the correction that the issue's own premise is false.

> **Amended 2026-09-21.** §9 is added, recording the answer to [#676](https://github.com/orphic-inc/stellar-api/issues/676): the handout is **member-scoped** and keeps accruing while registration is closed, so #676 closes with no behavioural change. The amendment also supersedes the Context paragraph below headed "`maxUsers` is not a backstop", which ends "nothing in this ADR may rely on it" — [#624](https://github.com/orphic-inc/stellar-api/issues/624) and [ADR-0040](0040-capacity-is-counted-in-enabled-seats.md) landed seat enforcement in `registerUser` after this ADR was accepted, and §9 relies on exactly that.

## Context

**The invite economy has a sink and no source.** `User.inviteCount` is decremented in exactly one place — `createInvite` (`modules/profile.ts:1317`) — and incremented nowhere. The only writes that raise it are `routes/api/install.ts:210`, which gives the founding SysOp 100, and the dev-tools user generator. A production instance that spends those 100 can never issue another invite without a direct database write.

#282 was iceboxed on the reasoning that _"the invite economy is manual + rank-driven today, and an automatic handout would duplicate rank-progression rewards"_. **Both halves are false.** No staff or admin route writes `inviteCount` — `grep -rn inviteCount src/routes` returns only `install.ts`. And `rankProgressionJob.ts` promotes, demotes and notifies; it touches no invite field.

Four further facts from the code decided the rest, and none is stated in #282.

**Staff do not need this.** `POST /api/users` (`routes/api/user.ts:630`, behind `users_edit`) creates an account outright, consuming no invite. So the faucet is a member privilege, not the site's onboarding path, and a stalled job costs members a perk rather than costing the site growth.

**`maxUsers` is not a backstop.** `modules/settings.ts:18` defaults it to 7000, `modules/stats.ts:65` reports it, `routes/api/install.ts:88` nags the operator to _"set a launch-ready capacity limit"_ — and `registerUser` never reads it. `stats.ts:8` even comments that a registration _"eats a slot against `maxUsers`"_, describing accounting that does not exist. It is filed separately; nothing in this ADR may rely on it.

**Standing is already a solved problem.** `computeStanding` (`modules/standing.ts`) is pure, unit-tested, and rolls active `UserWarning` rows plus ban state into the ADR-0004 tier ladder. Its `banEvasion` seam is documented as waiting on _"the invite-tree/account linkage"_ — this domain.

**A fresh account computes as `clean`.** `pristine` needs a year of tenure, but zero warnings is `clean` from day one, so governance standing alone does not withhold anything from a brand-new member.

**The CRS `invite` dimension already rewards good genealogy.** `modules/reputation.ts:270-307` scores an inviter on active-contributing and long-lived invitees, eroded by banned and dormant ones. The icebox note's fear of a duplicate reward was sound; it named the wrong mechanism.

## Decision

### 1. #282 is the faucet, and it is accrual rather than top-up

A member of a rank gains `UserRank.inviteGrantPerPeriod` invites every period, clamped at `UserRank.inviteCap`. The balance is never _set_ to the cap.

_(Amended 2026-09-14, by [#627](https://github.com/orphic-inc/stellar-api/issues/627) and [ADR-0041](0041-an-invite-lapses-and-is-returned.md). This job is no longer the only code path that raises `inviteCount`: a lapsed invite is refunded to its inviter. The cap bounds **accrual**, not holdings, so a refund is added in full even when it takes a balance past the cap, and this job's `lte cap - amount` predicate then withholds accrual until the member spends back under. The faucet is still the only source of **new** invites, since a refund returns one that was already spent.)_

The rejected alternative, topping each balance up to its cap, is idempotent and needs no state: a missed run heals on the next pass and a double run is a no-op. Accrual buys a distinction that top-up cannot express — the rate of replenishment is a separate dial from the ceiling, so a class can hold many invites while earning them slowly. The cost is that the job is no longer safe to run twice, which forces decision 2.

### 2. The clock is per member, persisted, and does not back-pay

`User.lastInviteGrantAt` is added. A grant requires `now - origin >= 14 days`, where the origin is that stamp or, when it is null, `dateRegistered`.

The stamp must be durable rather than implied by the job's interval timer. `app.ts` starts every background job at boot, so an in-process timer would make each redeploy a handout — twenty deploys in a day would be twenty grants.

The `dateRegistered` fallback is what keeps `registerUser` out of this. Writing the stamp at registration would put a field no registration path reads inside a transaction in `modules/auth.ts`, a listed high-risk area, and would force the migration to choose a backfill value for every existing member. The fallback answers both: a brand-new member and a member who predates the feature are both correctly clocked from the date they joined.

**No back-pay.** A gap of six periods grants one period, not six. This is `inactivity.ts`'s warn-grace reasoning applied to the other sign: a job that was down for a month must not do a month's work in the pass that brings it back.

### 3. A period the member had no room for is spent, not banked

An eligible member already at their cap has their clock advanced and receives nothing.

Without this the stamp of a member holding at cap goes stale, and they grant the instant they spend — which is top-up-to-cap semantics arrived at by accident, with a per-user column bought for nothing. It would also mean a hoarder replenishes faster than a member who spends steadily, which inverts the intent.

It costs a second `updateMany` per pass over the clamped set. That is the whole price of the rule, and it is worth paying.

### 4. Governance standing gates the faucet; the tenure floor does not live in configuration

No grant below the `neutral` tier — so `poor` (2+ active warnings) and `hammer` (banned, or 4+) earn nothing. The tier comes from `computeStanding`, not from a local `banDate`/`warned` predicate.

`standing.ts` and `ruleImpact` already drifted into two structurally-identical copies of `Standing`; a third reading of "who is in bad standing", written inline in a job's `where` clause, is how that becomes unrecoverable. This is the same instinct as [ADR-0001](0001-granular-permission-checks.md)'s ban on ad-hoc role checks.

_(Extended 2026-09-15, by [#636](https://github.com/orphic-inc/stellar-api/issues/636). Staff can revoke one member's invite privileges (`User.canInvite = false`). A revoked member is exempt in the same way as `poor` standing: the decision is `none` and the clock does not move, so a restore grants at most one period. The two stay separate reasons. The cycle tally counts revokes as `revoked`, and `withheld` keeps meaning standing only. The grant write also requires `canInvite: true`, so a revoke landing between the read and the write is not granted over.)_

Withholding a grant is also the right severity. Contagion is _"suspect, never condemned"_, and this is the matching consequence: the member keeps every invite they already hold, and simply earns none while the site is unhappy with them.

_(Extended 2026-09-15, by [#637](https://github.com/orphic-inc/stellar-api/issues/637) and [ADR-0043](0043-sending-an-invite-is-gated-on-the-inviter.md). The same tiers now also refuse sending, through this section's `isStandingDenied`, so the handout and the send share one reading of bad standing. The member still keeps their balance; they cannot spend it until the warnings expire.)_

Separately, a **30-day tenure floor is a constant in `inviteGrant.ts`**, overridable by no rank row. The rate and cap are admin-editable columns, which is a typo surface, and standing does not cover it — a day-old account is `clean`. `inactivity.ts` keeps its thresholds in code so that changing them is a review rather than an environment variable someone mistypes into 11; the floor is the same argument aimed at a form field.

### 5. Rate and cap are per-rank columns; the period and the tick are not

`UserRank.inviteGrantPerPeriod` and `UserRank.inviteCap`, both `Int @default(0)`, alongside the three per-rank allowance columns the model already carries. Tunable through the `/tools/user-ranks` CRUD that already exists, and **fail-closed**: every rank that predates this hands out nothing until staff opts it in.

Neither is nullable. `assetLimit` directly above them uses `null` for "unlimited" — deliberately not repeated here, because an uncapped invite faucet is not a state we want expressible.

The 14-day period stays a code constant. The **tick is independent of it**: `INVITE_GRANT_INTERVAL_MS` defaults to daily, so each member grants on their own anniversary rather than at a site-wide boundary. That spreads the write load across the period and means nobody waits up to 13 days for a cycle to come round. Conflating the two would waste the per-member stamp.

### 6. Writes are conditional increments, never absolute values

```ts
updateMany({
  where: { id: { in: ids }, inviteCount: { lte: cap - amount } },
  data: { inviteCount: { increment: amount }, lastInviteGrantAt: now }
});
```

The predicate is re-evaluated at write time, so a member who spends an invite between our read and our write falls out of the update rather than having a stale balance written over their spend. It is also self-clamping: the cap cannot be exceeded even if the evaluator were wrong.

The accepted cost is an under-grant of less than `perPeriod` at the ceiling — a member with cap 5, rate 2 and balance 4 receives nothing until they spend down to 3. Partial top-ups to exactly the cap were rejected: they need the read balance to still hold at write time, which reintroduces precisely the lost-update race this avoids.

### 7. One audit row per cycle, not one per member

`invites.granted` on `SiteSettings`, carrying the tally — granted, invites, at-cap, withheld-on-standing, and a per-rank breakdown.

`AuditLog` (`schema.prisma:2153`) carries **no indexes at all** and nothing prunes it; `inactivityJob.ts:18` says so. A weekly per-member row would be tens of thousands a year, unindexed, for an event that is uniform and already reconstructible from the member's rank and `lastInviteGrantAt`. Per-member rows are right for a disable or a rank change because those are rare and consequential; a recurring `+2` is neither.

The row answers the questions actually asked of a faucet: did it run, what did it do, was it configured right.

### 8. Bonus grants on invitee performance are out of scope

The clause in #282's body is deferred to its own issue, because it carries a product question that should not be settled inside a job PR: **does good genealogy pay twice?** The CRS `invite` dimension already rewards exactly this signal.

Recorded for that issue: the better shape is probably to raise the **cap** rather than the rate. That rewards a proven recruiter with capacity, so a poor one can out-_hold_ their class but never out-_earn_ it.

### 9. The faucet is member-scoped; site state belongs to the gate

Raised as question 5 of [#673](https://github.com/orphic-inc/stellar-api/issues/673), deliberately not settled there, and answered by [#676](https://github.com/orphic-inc/stellar-api/issues/676): **no code change.** The handout keeps accruing `inviteCount` while registration is closed.

`exemptionReason` closes the faucet on six things — `disabled`, a staff rank, `perPeriod <= 0`, `cap <= 0`, `canInvite`, and denied standing. Every one is a fact about the **member** or about **rank configuration**. Not one is a fact about the **site**, and neither `inviteGrant.ts` nor `inviteGrantJob.ts` reads any site setting. #676 filed that as an oversight. It is the rule:

> Site state governs an invite at the moment it is **acted on**, never at the moment it **accrues**.

The gate decides an action happening now, against the site as it is now — which is why `firstInviteRefusal` reads `registrationClosed` and `siteFull` ([ADR-0043](0043-sending-an-invite-is-gated-on-the-inviter.md)). The faucet grants an allowance for an action at an unknowable future time. What the site's state will be then is not knowable now, so reading it here is _meaningless_ rather than merely unnecessary.

Two corollaries, both easy to get wrong.

**Purity is a separate rule, and it cannot justify this one.** `inviteGates.ts` and `registerUser` are both pure with respect to settings: the caller resolves site state and passes it down, which is why `registerUser` takes `registrationMode` and `maxUsers` as arguments. `inviteGrantJob` could do the same and hand the evaluator a `registrationClosed` boolean without breaking that convention at all. The member-scoped rule is substantive and stands on its own. An argument from purity would not hold, and a reader who tested it would be right to reject it.

**It binds the handout only.** A pending invite is a live offer to a third party, not an allowance, so it sits on the gate's side of this line. [#677](https://github.com/orphic-inc/stellar-api/issues/677) proposes teaching `inviteExpiryJob` about closure, and nothing in this section pre-judges it.

#### Why keeping accrual is safe

**A balance cannot mint a seat.** Since [#624](https://github.com/orphic-inc/stellar-api/issues/624) and [ADR-0040](0040-capacity-is-counted-in-enabled-seats.md), `registerUser` takes `pg_advisory_xact_lock` and _then_ counts seats, inside the registration transaction — lock, then count, so a caller that waited on the lock counts the seat its predecessor just took. A refusal returns before any write, leaving the invite `pending` to lapse and refund under [ADR-0041](0041-an-invite-lapses-and-is-returned.md). Supply is therefore not the binding constraint on a reopening; seats are. #676's own defence — that `cap` bounds the growth — is true but weak, since `cap` times the membership can still be thousands. Those thousands compete for a seat count that does not move.

What a large accrued supply does change at reopening is **speed**: freed seats are taken in minutes rather than over weeks, and surplus invites park for up to three days before refunding. Both are operator concerns, and the lever is `maxUsers`, raised in steps. The faucet is the wrong place to meter a reopening, because pausing accrual meters _the members who waited_, not the rate of arrival.

**Nothing else reads the balance.** `inviteCount` has no reader outside the invite modules. In particular the CRS `invite` dimension scores a member's **invitees** — active-contributing, long-lived, banned, low-quality — and never their balance (§8). An accrued balance is inert until spent, so accruing through a closure has no second-order effect to weigh.

**Pausing would cost real supply for a state the member had no part in.** There is no back-pay (§2), so a paused period is simply gone. `canInvite` is deliberately `'none'` rather than `'advance'` because a revoke is a decision _about the member_. A closure is not, and the two must not be conflated on the strength of both meaning "cannot send right now".

#### The at-cap case under a closure, corrected

#676 records that a member below cap accrues through a closure while a member at cap spends periods for nothing, and calls that asymmetry "most visible and least defensible" during a long closure. The arithmetic says the opposite, and the issue's framing is corrected here rather than carried forward.

At cap the member receives nothing **either way**. Had the evaluator returned `grant`, the conditional write's `inviteCount: { lte: cap - amount }` predicate (§6) would have skipped them. So at cap, `advance` decides exactly one thing: whether the clock moves.

Follow a closure through with `cap` 10 and `perPeriod` 3. A member at 0 accrues 3, 6, 9 and then rests, because 9 is past `cap - perPeriod`; a member at 1 accrues to 10 and rests. Everyone converges to within one `perPeriod` of cap and stops. The asymmetry is therefore **transient** — it lasts until the below-cap member converges, and then it is gone. Every period after that, `advance` withholds a grant the cap would have eaten anyway, at a cost to the member of zero.

The one real cost lands at reopening: a member who spends down the day after a clock advance waits up to `PERIOD_DAYS` for their next grant, where a frozen clock would have granted the following night. That is bounded at **one period's delay, once** — not a period lost per cycle.

A closure is thus where §3 is at its _most_ defensible, not its least. §3 guards against freezing the clock at cap becoming top-up-to-cap by accident, so that a hoarder earns faster than a spender. During a closure there are no spenders, so the rule withholds nothing anybody could have used.

#### What stands against the edit

`inviteGrantJob.spec.ts` asserts that a full cycle performs **no site-settings read**. It fails the moment the faucet is taught about closure, which is the edit this section rules out, and no rewording of a comment can satisfy it.

It guards a second property in passing. `getSettings()` is an `upsert` — a write, not a read — so a settings read per batch would turn a read-only nightly sweep over thousands of members into one write per batch. That hazard was found while grilling #673, where `getInviteRefusal` was about to pay a second one on every eligibility poll.

## Consequences

Merging this changes nothing observable. `INVITE_GRANT_MODE` defaults to `off` and every rank's rate defaults to `0` — two independent switches, both shut. `dryRun` evaluates the whole membership and writes nothing, which matters more here than elsewhere: nothing in the codebase has ever raised `inviteCount`, so a live pass has no precedent to compare against.

`/tools/user-ranks` gains two fields on all four routes. Additive and staff-only; stellar-ui needs its rank admin form updated and nothing else. No member-facing response changes — a `nextGrantAt` on the profile was considered and rejected, because it would promise invites to any member whose rank rate is `0` or whose standing is `poor`.

The site can now manufacture account slots against a ceiling nothing enforces. That is not new, but this is what makes it reachable, and it is filed separately.
