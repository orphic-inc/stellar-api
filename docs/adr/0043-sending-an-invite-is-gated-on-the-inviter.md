# Sending an invite is gated on the inviter

**Status: Accepted (2026-09-15).** Accepted as the gate on [#637](https://github.com/orphic-inc/stellar-api/issues/637), the posture [ADR-0040](0040-capacity-is-counted-in-enabled-seats.md) and [ADR-0041](0041-an-invite-lapses-and-is-returned.md) took. It records the decisions from the grill on that issue, [recorded on the issue](https://github.com/orphic-inc/stellar-api/issues/637#issuecomment-5683530680). It extends [ADR-0039](0039-invite-supply-is-class-based-accrual.md) §4, ADR-0040 §3 and ADR-0041.

## Context

**Anyone with a positive `inviteCount` could send an invite**, unless staff had revoked their privileges (#636) or the site was full (#624). The legacy implementation refused a member the site considered a liability: one on ratio watch, or one whose download privileges were gone. It also had two staff permissions, one for unlimited invites and one for inviting past the user limit.

[ADR-0039](0039-invite-supply-is-class-based-accrual.md) made invites a scarce, accrued resource, and ADR-0004's Contagion model runs down the invite tree. Who may grow that tree now matters more than it did.

Five facts from the code shaped the decisions:

- **`canDownload = false` has two causes**, and they cannot be told apart. `modules/ratioPolicy.ts` writes it when a watch fails and when staff override the status to `DOWNLOAD_DISABLED`. Neither clears on its own ([#646](https://github.com/orphic-inc/stellar-api/issues/646)).
- **The stored `WATCH` status goes stale.** `evaluateRatioPolicy` runs only after a download. A member who recovers by contributing stays `WATCH` in the row, and so does a watch that ran out without a download.
- **Standing already gates the handout.** `isStandingDenied` withholds accrual at `poor` and `hammer`.
- **Every refund pays for an invite that was spent.** Expiry, cancel and withdraw each add one on a claimed transition.
- **The Golden Rules already say what the legacy invite page said.** Rule 1.1 covers one account per lifetime, 2.1 covers responsibility for invitees, and 2.2 covers trading. `GET /rules/tree` serves all three.

## Decision

### 1. Six gates, in one order

`firstInviteRefusal` in the pure `modules/inviteGates.ts` answers the first gate that refuses, in this order:

| #   | Reason               | Refuses when                                                   |
| --- | -------------------- | -------------------------------------------------------------- |
| 1   | `invites_revoked`    | `canInvite = false`                                            |
| 2   | `downloads_disabled` | `canDownload = false`, whichever cause set it                  |
| 3   | `poor_standing`      | `isStandingDenied(computeStanding(...))`                       |
| 4   | `ratio_watch`        | the row says `WATCH` **and** the ratio read now is still short |
| 5   | `site_full`          | `isSiteFull()`                                                 |
| 6   | `no_invites`         | `inviteCount` is `0`                                           |

An address already invited is refused after all six, as `already_invited`.

The order is what the member would have to fix first, with staff decisions above state the member caused. Before this, a revoked member on a full site was told to try later.

Standing uses the handout's own definition. A second reading of "bad standing" is the drift §4 of ADR-0039 warns against, and a later threshold change should move both. The member keeps their balance, and the refusal lifts when warnings expire.

Ratio watch combines the stored status with a fresh `getRatioStats`, which is what the legacy rule meant. The ratio is computed only when the row says `WATCH`, and `ratioPolicy.ts` stays read-only.

### 2. Staff decisions refuse atomically; the rest are courtesies

`createInvite` loads the member's state and refuses before it writes, so a refused member spends nothing.

`canInvite` and `canDownload` are also in the spend's conditional predicate, `inviteSpendWhere`. A revoke or override landing mid-send therefore refuses the write rather than racing it, and the in-transaction read names the reason in the same order.

Standing, ratio and capacity are read without a lock. A member whose warnings or ratio change mid-send gains nothing worth one, which is the argument ADR-0040 §3 made for capacity.

One exemption: an empty balance does not refuse a member re-inviting their own lapsed invite that the sweep has not reached. The refund inside the write pays for that send (ADR-0041), and the spend predicate still has the last word. No other gate is exempted.

### 3. Each refusal is its own `403 { msg }`

The body gains no fields. The words say which of very different things to fix, and each says the invite was not used. `downloads_disabled` names Staff PM, because nothing lifts it on its own today.

### 4. Eligibility is answered before the send

`GET /profile/me/invites/eligibility` returns `{ canSend, reason, msg }` from the same evaluator, and the route takes both refusals' words from one map. The ui can hide the form and explain before anyone submits, as the legacy page did, and it cannot disagree with the POST.

The machine-readable `reason` lives here and not on the error body, where it would be a convention for one route.

### 5. Unlimited invites are a permission, and an unspent invite is recorded

`invites_unlimited` sits in the `users` permission group. No seeded rank grants it, and `admin` implies it. The route resolves it, never the module.

It skips only `no_invites` and the spend. Every other gate applies, so a SysOp with active warnings is refused like anyone else.

**`Invite.spent`** (`Boolean`, default `true`) records whether the send paid. Both refund sites pay only for a claimed row with `spent = true`, and read it from the row they claimed.

Checking the permission at refund time was rejected: grant, send, revoke and withdraw would mint an invite.

The handout does not change. An unlimited member's stored balance keeps accruing to the cap, as the real fallback if the permission is removed. `inviteCount` stays the stored number in every response, and the eligibility response gains `unlimited: boolean`. `null` already means "hidden" on the profile.

### 6. No permission to invite past capacity

Since ADR-0041, a registration refused at capacity keeps its key, and expiry refunds it. A send-side bypass would buy a three-day hold and one email. A registration-side one would reverse ADR-0040 §2 and §3.

Growth past the cap stays a staff decision through `POST /users`.

### 7. The rules text is the Golden Rules

The invite page quotes Golden Rules 1.1, 2.1 and 2.2 from `GET /rules/tree`. The api serves no invite-page copy of its own.

## Consequences

`POST /profile/referral/create-invite` has three new refusals, and capacity now refuses after the member's own gates. `GET /profile/me/invites/eligibility` is new. Both are additive for stellar-ui.

A member on ratio watch, with lost download access, or in `poor` standing can no longer send. Nothing about their pending invites or their accrual changes.

Delivery is two PRs. The first ships Decisions 1–4. The second ships Decision 5 and carries the migration and the refund-site changes, which are reviewed apart from the gate logic.

Because `DOWNLOAD_DISABLED` never lifts on its own (#646), a member whose downloads were disabled by a failed watch stays unable to invite until staff act. Fixing #646 fixes this gate with it, because the gate reads the column.
