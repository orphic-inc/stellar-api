# An invite lapses and is returned

**Status: Accepted (2026-09-14).** Accepted as the gate on [#627](https://github.com/orphic-inc/stellar-api/issues/627), whose implementation follows this contract, the posture [ADR-0040](0040-capacity-is-counted-in-enabled-seats.md) took on #624. It records the decisions from the grill on that issue, [recorded on the issue](https://github.com/orphic-inc/stellar-api/issues/627#issuecomment-5671754407). Builds on [ADR-0039](0039-invite-supply-is-class-based-accrual.md), whose Decision 1 this amends.

## Context

**`Invite.expires` was written and never read.** `createInvite` set it 30 days out, and `registerUser` checked only `status === 'pending'` and the email, so an invite key stayed usable forever. No commit had ever compared against the column.

**A check at registration alone makes things worse.** The inviter's balance is spent at send time, so a lapsed invite would simply be lost. `Invite.email` is `@unique`, and `createInvite` refused any address with a row, so an address whose invite lapsed could never be invited again, by anyone. `InviteStatus` had no way to record the lapse, and its `rejected` value was written by nothing.

[ADR-0039](0039-invite-supply-is-class-based-accrual.md) is what made this matter. Invites are now a scarce, accrued resource, one period every 14 days, and losing one to a lapse costs real time.

Kai decided three things before the grill:

- an expired invite goes back to the inviter;
- the address can be invited again, by anyone;
- expiry is an explicit status.

Four facts from the code decided the rest:

- **Every rank's `inviteCap` defaults to `0`**, and `/install` gives the founding SysOp 100 invites regardless of it.
- **Prisma 6.19 cannot express a partial unique index.** A raw-SQL one shows as drift in `migrate diff`, which is how hand-written migrations here are verified.
- **Registration refuses a full site before any write**, so an invitee turned away at capacity keeps a pending invite. `isSiteFull` is a count with no history.
- **Nothing sets `User.banDate`** ([#634](https://github.com/orphic-inc/stellar-api/issues/634)), so `disabled` is the only removal state.

## Decision

### 1. An invite lives three days, and the lifetime is code

`INVITE_TTL_DAYS = 3`, a constant in the pure `modules/inviteExpiry.ts`, which ADR-0038 §4 calls a threshold rather than a dial. It decides when refunds happen, so it moves by review. The invite email builds its "expires in N days" from the same constant.

Invites sent before this change keep the 30 days their email promised. `Invite` gains `createdAt`, and existing rows are backfilled as `expires − 30 days`, the only estimate available.

### 2. One lapse rule, read by every gate

An invite has lapsed when it is `expired`, or `pending` past `expires`, or `pending` with a **disabled inviter**. `isInviteLapsed` is that rule. Registration, `createInvite` and the sweep all read it, so the three cannot disagree. An `accepted` invite never lapses: it was used.

The disabled-inviter arm exists because a disable within three days of a send is almost always a staff act, and a member disabled for abuse should not keep bringing people in. The cost falls on the rare invitee of a member the inactivity sweep caught, and anyone can re-invite them at once.

_(Extended 2026-09-15, by [#636](https://github.com/orphic-inc/stellar-api/issues/636). An inviter whose invite privileges staff revoked (`User.canInvite = false`) is the rule's second inviter-side arm, for the reason the disabled-inviter arm gives. `isInviteLapsed` and both where-fragments carry it, so registration, re-invites and the sweep still agree. The key holder is answered `invite_expired`, and a revoke frees the member's pending invites within the hour. As with a disable, restoring the flag does not revive an invite the sweep has already expired.)_

### 3. The transition pays the refund, and the refund ignores the cap

Whoever moves a row from `pending` to `expired` refunds it. The claim is a conditional `updateMany` over the lapse predicate, and only a claim that moved one row increments the inviter, in the same transaction. The sweep is the usual writer. A re-invite of a lapsed address that nobody has expired yet is the other, and the claim keeps the refund exactly-once between them.

Accepting an invite at registration is a claim too, over the live predicate. Without it, the sweep can expire and refund an invite between the registration's pre-check and its write, and the invite is counted twice. If the claim moves no row, the transaction rolls back the user it created and answers `invite_expired`.

The refund is a plain `increment: 1`, **even past `inviteCap`**. A refund returns an invite that was already the member's, and the cap bounds accrual, not holdings. Clamping was rejected on the defaults alone: with every cap at `0`, every refund would be zeroed, including the founding SysOp's. ADR-0039's `lte cap - amount` predicate already withholds accrual from a member over the cap.

A disabled inviter is refunded too. The balance is inert while they are disabled, and it matters only if staff re-enable them, which is a judgement that they are acceptable again. Taking invites from a disabled member is a separate decision for the disable path, not a special case here.

_(Extended 2026-09-15, by [#637](https://github.com/orphic-inc/stellar-api/issues/637) and [ADR-0043](0043-sending-an-invite-is-gated-on-the-inviter.md) §5. A sender with `invites_unlimited` spends nothing, so their invite records `Invite.spent = false`. Every claim above — expiry, re-invite, cancel and withdraw — still makes the transition exactly once, but increments the inviter only for a spent row. `spent` is read after the claim, which holds the row, so a re-invite refunds by the old send's flag before writing the new one. The audit row's `refunded` records which happened, and the PM and route words drop "returned" for an unspent invite.)_

### 4. The sweep is always on and runs hourly

`inviteExpiryJob` claims each lapsed invite in its own transaction, so one bad row is logged rather than aborting the cycle. It pages on `id > cursor`, and a new `(status, expires)` index serves the query.

There is **no mode switch**, unlike the inactivity and invite-grant sweeps. Their switches bound damage, since those jobs disable members or create invites. This one only returns spent invites. And because the gates refuse a lapsed key regardless, a sweep defaulting to `off` would leave invites dead **and** unrefunded, which is the state the Context calls worse than never expiring them. `INVITE_EXPIRY_INTERVAL_MS` defaults to one hour, because a daily tick would hold a refund back for a third of an invite's life.

A consequence to know: the disabled-inviter arm means a staff disable frees that member's pending invites within the hour, and re-enabling them does not revive those invites.

### 5. The row is reused; `email @unique` stays

A lapsed row is expired if it has not been, then reused in place, taking a new `inviterId`, `inviteKey`, `expires` and `createdAt` and returning to `pending`. The reuse is conditional on the row being `expired` at write time, so two concurrent re-invites cannot both take it. The history lives in the audit log: `profile.invite.create` per send and `invite.expired` per lapse.

Dropping `@unique` to keep one row per send was rejected. Without a partial index, "one live invite per address" would need an advisory lock around the check and the insert, which is machinery for history the audit log already holds.

The spend in `createInvite` becomes a conditional decrement (`inviteCount > 0`) that runs after any refund, so a member re-inviting their own lapsed address is never refused for a balance the refund just restored.

### 6. The key holder is told it expired, the same way every time

A lapsed key answers `403` with `invite_expired`: "This invite has expired. Ask the member who invited you to send a new one." That includes a key whose inviter is disabled. If that case answered `invalid_invite` instead, the reply would change once the sweep marked the row `expired`, and the change itself would reveal the disable. The email match is checked before the lapse, so a key that is not yours says nothing about whether it is live.

A full site does not pause the clock. Pausing needs a record of when the site was full, which nothing keeps, and extending `expires` on each refused attempt would let a patient invitee hold an address forever. The refund makes a lapse lossless, so the full-site `403` says **"Your invite is valid until {date}"** instead of promising it is still valid.

### 7. The inviter is told, after the commit

Every lapse writes an `invite.expired` audit row. The original inviter gets a System PM, sent after the transaction commits so a failed PM cannot undo a refund. `sendSystemMessage` refuses disabled recipients, which is the intended outcome. A member re-inviting their own address gets no PM, since they are the one who did it.

_(Extended 2026-09-15, by [#636](https://github.com/orphic-inc/stellar-api/issues/636). An inviter whose invite privileges are revoked gets no PM either, from the sweep or from a re-invite. Their invites lapsed because of the revoke, not because time ran out, and "you can invite that address again" would be false. The refund and the audit row are unchanged. Staff can PM the member about the revoke itself.)_

### 8. `rejected` is dropped

`InviteStatus` is `pending | accepted | expired`. Nothing wrote `rejected`. Postgres cannot drop an enum value in place, so the migration rebuilds the type and maps any `rejected` row to `expired` inside the cast. A revoke, if one is ever wanted, is one value and its own issue.

_(Extended 2026-09-15, by [#636](https://github.com/orphic-inc/stellar-api/issues/636). That value is `cancelled`, for staff cancelling an invite from the pool. #640's member withdraw will use it too. It is not named `revoked`, which now names the per-member privilege flag. This section's rules apply to it as they do to `expired`:_

- _**§2:** a `cancelled` invite has lapsed._
- _**§3:** the refund rule generalises to "an invite that leaves `pending` without being accepted returns to its inviter", whoever ended it. The cancel is a conditional `pending → cancelled` claim that pays an uncapped refund in the same transaction. It claims any `pending` row, including one past `expires` the sweep has not reached, so exactly one of cancel, expiry or acceptance wins._
- _**§5:** a re-invite reuses an `expired` or `cancelled` row._
- _**§6:** the key holder is answered `invite_expired`, so the reply cannot confirm a moderation act, and a cancel racing registration lands there through the accept claim anyway._

_Unlike an expiry, the inviter is PMed only when staff write a message.)_

_(Extended 2026-09-15, by [#640](https://github.com/orphic-inc/stellar-api/issues/640). A member can withdraw their own pending invite. The withdraw is the same `pending → cancelled` claim, scoped to the caller's invites, so another member's invite answers 404. It refunds, audits with `by: 'inviter'` and sends no PM. It needs no invite privileges._

_**§5 changes:** a `cancelled` row holds its address until its original `expires`. Its key is refused at once, but the address is not free for a re-invite until then. Without this, a withdraw's refund would let a member send, withdraw and send again, mailing one address without limit. "Is this key usable" (`isInviteLapsed`) and "is this address free" (`isAddressFree`) are now separate rules in `inviteExpiry.ts`. The rule applies to staff cancels too.)_

## Consequences

The invite contract changes. `InviteStatus` loses `rejected` and gains `expired`, `InviteItem` gains `createdAt`, registration has a new `403` message, and the full-site message names a date. stellar-ui consumes these in [ui#330](https://github.com/orphic-inc/stellar-ui/issues/330). _(Corrected 2026-09-15: this pointed at ui#328, which is the automated contract-drift report and never tracked this work.)_ The invite pool filter that sent uppercase statuses, and was answered `400` for every choice, is fixed in [ui#329](https://github.com/orphic-inc/stellar-ui/issues/329) with the `cancelled` status.

`inviteCount` now has three writers: the send spends, the faucet accrues, and a lapse refunds. The faucet stays the only source of new invites.

A staff disable now has an effect on invites it did not have before, freeing the member's pending ones within the hour. Nothing records a disable reason (ADR-0038 §3), so an inactivity disable has the same effect.

Two things were found while grilling and deliberately left out. Registration never writes the `InviteTree` edge ([#633](https://github.com/orphic-inc/stellar-api/issues/633)); this ADR does not constrain its backfill, because only `accepted` rows can rebuild an edge and an `accepted` row is never reused. Nothing sets `banDate` ([#634](https://github.com/orphic-inc/stellar-api/issues/634)).
