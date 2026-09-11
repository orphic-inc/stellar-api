# Invite supply is class-based accrual

**Status: Accepted (2026-09-11).** Accepted as the gate on [#282](https://github.com/orphic-inc/stellar-api/issues/282), whose implementation follows this contract rather than preceding it — the posture [ADR-0038](0038-inactivity-is-a-clock-not-a-timestamp.md) took on #279. It records the decisions taken while scoping #282, starting with the correction that the issue's own premise is false.

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

Withholding a grant is also the right severity. Contagion is _"suspect, never condemned"_, and this is the matching consequence: the member keeps every invite they already hold, and simply earns none while the site is unhappy with them.

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

## Consequences

Merging this changes nothing observable. `INVITE_GRANT_MODE` defaults to `off` and every rank's rate defaults to `0` — two independent switches, both shut. `dryRun` evaluates the whole membership and writes nothing, which matters more here than elsewhere: nothing in the codebase has ever raised `inviteCount`, so a live pass has no precedent to compare against.

`/tools/user-ranks` gains two fields on all four routes. Additive and staff-only; stellar-ui needs its rank admin form updated and nothing else. No member-facing response changes — a `nextGrantAt` on the profile was considered and rejected, because it would promise invites to any member whose rank rate is `0` or whose standing is `poor`.

The site can now manufacture account slots against a ceiling nothing enforces. That is not new, but this is what makes it reachable, and it is filed separately.
