# Inactivity is a clock, not a timestamp

**Status: Accepted (2026-09-10).** Accepted as the gate on [#279](https://github.com/orphic-inc/stellar-api/issues/279), whose implementation follows this contract rather than preceding it — the posture [ADR-0037](0037-group-dedup-is-a-read-time-projection.md) took on #605. It records four decisions taken while scoping #279 that the issue's own text either contradicts or does not reach.

## Context

Stellar has no dormancy handling. Accounts are disabled only by hand, through `POST /users/:id/enable|disable` behind `users_disable`, and a disabled member has no route back: `loginUser` answers `403 Account disabled` **before** it compares the password, so the account is already distinguishable at login, and `/auth/recovery/request` will happily mail them a working password they still cannot use.

Four facts from the code decided the rest, and none is stated in #279.

**`lastLogin` is a good signal, but only because the token is short.** The JWT TTL is one hour (`routes/api/auth.ts:49`) with no refresh endpoint, so an active member re-authenticates roughly hourly and `lastLogin` tracks them closely. Registration, however, issues a cookie **without** stamping it (`modules/auth.ts:217`), and so does the admin create path (`modules/user.ts:141`) — so `lastLogin: null` means "registered and never came back", not "never used the site".

**The staff re-enable touches nothing but `disabled`.** `prisma.user.update({ where: { id }, data: { disabled: false } })` and an audit row. Under #279's rules as written, a reinstated member is disabled again within 24 hours: `lastLogin` and `inactivityWarnedAt` are both still stale, which satisfies the disable predicate on the next daily run. The reactivation flow #279 also specifies feeds straight into that loop.

**`AccountRecovery` has no purpose column, and `resetPasswordWithToken` matches any row.** Its `where` is `{ token, usedAt: null, expiresAt: { gt: now } }` (`modules/auth.ts:348`). #279 asks for reactivation tokens to be minted into this same table, under "compose existing pieces, no new models".

**`sendSystemMessage` refuses disabled recipients** (`modules/pm.ts:198`), returning `recipient_disabled`. Any notice sent after the disable is a silent no-op.

## Decision

### 1. The dormancy clock is `max(lastLogin, dateRegistered, reactivatedAt)`

Not `max(lastLogin, dateRegistered)` as #279 specifies. `User.reactivatedAt` is added and stamped by the re-enable handler, in the same write that clears `inactivityWarnedAt`.

Each term alone is wrong for some account. A member who registered and never returned has no `lastLogin`; one staff have just reinstated has a stale one. Without the third term the sweep undoes every reinstatement on its next run, which makes the appeals flow this same issue builds a loop rather than an exit.

The alternative — stamping `lastLogin` on re-enable — was rejected as a falsified reading. `lastLogin` drives the active-user counts in `modules/stats.ts` and a sort in `/search/users`; a re-enable is not a login and must not register as one.

The never-logged-in sweep reads the same clock, because `lastLogin` is **still null** after a re-enable and that arm would otherwise re-disable the account on its own terms.

### 2. Recovery tokens carry a purpose, and it is a column rather than convention

`AccountRecovery.purpose` (`PasswordReset` | `Reactivation`), defaulted so every pre-existing row keeps the only meaning it has had. Both consumers filter on it, and `persistRecoveryToken` scopes its invalidation by purpose so asking to be reinstated does not silently expire a password reset already in flight.

This is the one place the implementation refuses #279's "no new models" instruction, and it is a column, not a model. Without it a reactivation link is a password-reset link: the two are indistinguishable to every consumer. That link is mailed to an address dormant for four months, which is the address most likely to be stale or compromised, and handing it password-reset power as a side effect is an escalation nobody chose.

### 3. Appeals are open to every disabled account, including moderator actions

`POST /auth/reactivation-request` does not ask why an account is disabled. It answers with one generic sentence for an unknown address, an active account and a disabled one alike, and mints a token only for the last.

Restricting it to inactivity-disabled accounts would require recording a disable reason, and the route would still have to answer identically for a banned account or it becomes an oracle for who was banned. Since the response cannot differ, the restriction buys nothing a member can observe — it only removes the appeals path that someone who was banned will look for anyway. Staff already triage the inbox and already hold `users_disable`; the decision stays with them.

The confirm step is **idempotent per member**: where an unresolved staff-inbox conversation already exists, the token is still spent and a message is appended rather than a second thread opened. Keying on "any open ticket owned by this user" is safe precisely because they are disabled — every other route into that inbox requires a session.

### 4. Thresholds are code; blast radius is configuration

`WARN_AFTER_DAYS`, `DISABLE_AFTER_DAYS`, `WARN_GRACE_DAYS` and `NEVER_LOGGED_IN_DAYS` are constants in the pure evaluator, and the spec imports them rather than restating the numbers. A rule that disables member accounts should move by code review and a changelog entry, not by an environment variable someone can mistype into `11`.

`INACTIVITY_MODE` (`off` | `dryRun` | `on`, default `off`) and `INACTIVITY_MAX_DISABLES_PER_CYCLE` (default 50) are configuration, because they bound damage rather than define the rule. `dryRun` is a first-class state rather than a logging accident: it evaluates the whole candidate set and applies nothing, and the count it prints against real data is the only thing that makes turning it on a considered decision. The cap applies to disables only — a warning is recoverable by signing in, a disable needs staff to undo.

The never-logged-in sweep is restricted to **self-registered** accounts, identified by the absence of a `user.create` audit row. `registerUser` writes none; `createUser` writes one with a required non-null `actorId`; nothing in this tree prunes `auditLog`. Staff who create an account for someone away for a fortnight should not find it disabled on their return.

## Consequences

A deployment with no SMTP configured will still warn and still disable, notifying only through a System PM the member must sign in to read — sign-in being the act whose absence is being punished. This was raised and settled deliberately: the PM is the notice of record, and `dryRun` plus the per-cycle cap bound what a mis-set deployment can do. If that proves wrong in practice, the fix is to gate the warn stamp on delivery, as `/auth/recovery/request` already gates its token write.

Two orderings become load-bearing and must survive future edits. The warn PM precedes the disable because `sendSystemMessage` refuses disabled recipients, and the deactivation email precedes the `disabled` write for the same reason. Both are pinned by tests that fail by name.

`GET /auth` and the disable path now have a third reason an account can be disabled. Nothing reads a disable _reason_ today, and #279 deliberately does not add one — see Decision 3.
