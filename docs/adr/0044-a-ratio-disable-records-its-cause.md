# A ratio disable records its cause, and only a ratio disable lifts

**Status: Accepted (2026-09-15).** Accepted as the gate on [#646](https://github.com/orphic-inc/stellar-api/issues/646), the posture [ADR-0043](0043-sending-an-invite-is-gated-on-the-inviter.md) took on #637. It records the decisions from the grill on that issue, [recorded on the issue](https://github.com/orphic-inc/stellar-api/issues/646#issuecomment-5684881483). It amends [PRD-06](../prd/06-ratio.md)'s policy state machine and extends ADR-0043.

## Context

`modules/ratioPolicy.ts` runs the ratio policy as `OK → WATCH → DOWNLOAD_DISABLED`. A watch lasts 14 days. Downloads are disabled once 10 GiB is consumed during the watch, or when it expires with the ratio still short. PRD-06 said "the disabled state is reversed by staff only".

Grilling #637 surfaced three gaps:

- **A ratio-caused disable never lifted.** `evaluateRatioPolicy` runs only after a successful download, and a disabled member's download throws before it. The disabled state only refreshed a timestamp. A member who restored their ratio stayed disabled until staff noticed.
- **The two causes wrote the same status.** `POST /ratio-policy/:userId/override` set `DOWNLOAD_DISABLED` exactly as the automatic path did, and the row recorded nothing else. An automatic lift would have undone staff decisions.
- **The override wrote no audit row.** Its handler never read the request, so the acting staff member was not even known.

Five facts from the code shaped the decisions:

- **A disabled member's ratio moves without them.** `contributed` rises when others download their contributions or a bounty pays out. `requiredRatio` falls as approved contributions age past 72 hours. None of these calls the evaluator.
- **The two writers left the watch fields differently.** The automatic disable enters from `WATCH` and keeps `watchStartedAt`. The override to `DOWNLOAD_DISABLED` writes it null.
- **A staff watch was uncapped.** The override wrote `consumedAtWatchStart: null`, which the evaluator reads as nothing consumed. A staff watch could only end by expiry.
- **No ratio transition told the member.** The only signal was a banner on the profile's ratio panel, and its disabled text claimed a ratio cause for every disable.
- **The legacy implementation ran ratio watch on a daily schedule.** It re-enabled downloads for a member with a watch on record whose ratio had recovered, and it sent that member a message.

## Decision

### 1. A disable records its cause

`RatioPolicyState.disabledCause` is a `RatioDisableCause` enum, `RATIO | STAFF`. It is set only while `DOWNLOAD_DISABLED`; every other status holds null.

The automatic disable writes `RATIO`. The staff override writes `STAFF` for a disable and clears the cause for any other status.

Pre-#646 rows are backfilled from `watchStartedAt`: set means `RATIO`, null means `STAFF`. The backfill is a data-only migration of its own, so an integration test runs exactly its SQL. It skips a row that already has a cause.

A cause column was chosen over splitting `User.canDownload` into a staff-only lever, as `canInvite` is. The split is the cleaner model, but it redefines a field read by the download gate, the invite send gate (ADR-0043) and the ui. Inferring from `watchStartedAt` alone was rejected: the next change to how the override writes that field would silently turn staff disables into ones that lift.

### 2. Only a ratio disable lifts, and it lifts to `OK`

A `RATIO` disable whose ratio meets its requirement returns to `OK`. This is exactly the existing `WATCH → OK` exit: the watch and disable fields are cleared and `canDownload` is restored.

Meeting the requirement is the whole condition for leaving a watch, so a disabled member with the same ratio is not held to more. A fresh probation watch was rejected as a second penalty for one shortfall. If the member slips again, the next evaluation starts a new watch with its own 14 days and 10 GiB.

A `STAFF` disable is reversed by staff only.

### 3. The staff override is audited, and a staff watch is capped

The override takes `{ status, reason, message? }`. `reason` is required and written to a `ratioPolicy.override` audit row, with the acting staff member, the status and cause before and after, and whether a message was sent. `message`, when present, is sent to the member as a System PM after the write commits. This is the #636 pattern.

A staff `WATCH` stamps `consumedAtWatchStart` with the member's current `consumed`, so the 10 GiB rule applies to it as it does to an automatic watch.

The override stays an absolute write. A staff decision always wins over the automatic transitions (§6).

A staff `WATCH` or `OK` otherwise follows the normal rules, so the evaluator and the sweep can move it on. The only sticky staff decision is a disable. Exempting a staff watch from the early lift was rejected, because it would need a second policy for how such a watch ends.

### 4. The rules are pure, and a daily sweep applies them

A pure module owns the state machine. It maps the row's state, the ratio stats, `consumed` and a clock to one transition or none:

| From                          | Condition                                              | To                                 |
| ----------------------------- | ------------------------------------------------------ | ---------------------------------- |
| `OK`                          | short and `requiredRatio > 0`; after a download only   | `WATCH`                            |
| `WATCH`                       | meets the requirement                                  | `OK`                               |
| `WATCH`                       | 10 GiB consumed during the watch, or expired and short | `DOWNLOAD_DISABLED`, cause `RATIO` |
| `DOWNLOAD_DISABLED` / `RATIO` | meets the requirement                                  | `OK`                               |
| `DOWNLOAD_DISABLED` / `STAFF` | —                                                      | never                              |

The post-download evaluation and a daily sweep (`ratioPolicyJob.ts`) both use it.

The sweep walks only `WATCH` and `DOWNLOAD_DISABLED` / `RATIO` rows. It is cursor-paged, with one caught transaction per row, which is the `inviteExpiryJob` shape. It refreshes `lastEvaluatedAt` on rows it reads but does not move.

`OK → WATCH` stays download-triggered. Starting a probation while a member is idle would hand them a disable they had no chance to avoid.

Event hooks on every ratio-moving event were rejected. There are at least five call sites in unrelated modules, and eligibility ageing and watch expiry have no event, so a sweep would be needed anyway.

### 5. No mode switch

The sweep is live on deploy, with `RATIO_POLICY_INTERVAL_MS` (default 24 hours) and no `off | dryRun | on` switch.

Every transition applies an existing rule on a clock instead of at the member's next download.

- The lifts restore access the rule already says the member has.
- The one transition that removes access, expired watch to disabled, does so at most one download earlier than before.
- For invites nothing changes, because a short member on watch is already refused as `ratio_watch`.

A switch defaulting to `off` would keep this defect on every instance that never flipped it. That is the ADR-0040 §5 and ADR-0041 §4 argument. The one real first-run risk, a mislabelled backfill, is pinned by testing the migration's SQL rather than by a dry run.

### 6. Every automatic transition is a claim

An automatic transition is an `updateMany` on the observed `status`, `disabledCause` and `watchStartedAt`. `canDownload`, the audit row and the PM happen only when the claim moved the row.

`watchStartedAt` is in the claim so a stale read of an expired watch cannot disable a watch that staff just re-set. The override's absolute write makes any racing claim find nothing to move.

Locking the row for each evaluation was rejected. It would hold the lock across the ratio computation, which queries contributions.

### 7. The member is told, and the audit log explains

Every automatic transition writes one audit row: `ratioPolicy.watch_started`, `.download_disabled`, `.download_restored` or `.watch_cleared`. The row carries the status and cause before and after, the ratio and required ratio at the time, and `by: download | sweep`. The ratio moves afterwards, so the row is the only record of why.

Every automatic transition also sends the member a System PM after commit, linking the ratio rules page. A disable PM without a watch PM would make the penalty the first notice; the watch exists to give 14 days' warning.

### 8. The cause is visible to the member and to staff

`disabledCause` is in `RatioPolicyState`, which is both `GET /profile/me/ratio`'s `policy` and `GET /ratio-policy/:userId`. It is also in `RatioWatchItem`. A member needs to know whether to improve their ratio or talk to staff.

Only the cause is exposed. The staff `reason` stays in the audit log.

`GET /users/ratio-watch` moves from `include` to an explicit `select`. `include` returned the whole row, including the undocumented `consumedAtWatchStart`.

## Consequences

Delivery is three PRs, each against `main`:

1. §1, §3 and §8, with this ADR.
2. §4's pure rules, §6 and §7 on the post-download path.
3. The sweep and §5.

The override's required `reason` breaks stellar-ui's `RatioPolicyPanel` until it sends one. The ui also owes the member banner a split by cause.

Members start receiving PMs for ratio transitions when the second PR ships. Ratio disables start lifting when the third ships.

ADR-0043's `downloads_disabled` send gate reads `canDownload`, so it lifts with a ratio disable and needs no change.
