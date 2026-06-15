# Delegated IRC authentication — the IRCd validates against this API, no credential mirror

**Status: Superseded by [ADR-0013](0013-korin-pink-irc-integration.md) (2026-06-14).** IRC moved out of stellar-api into the external korin.pink service; the delegated SASL-validate callback and per-user IRC credentials described here were removed from the codebase. Original status: Accepted (2026-06-13). Serves [PRD-02 IRC + Announce](../prd/02-irc-and-announce.md) (draft). Motivated by the single-source-of-truth discipline of [ADR-0009](0009-fork-workflow-and-dependency-discipline.md) / [ADR-0010](0010-trunk-based-single-branch-workflow.md); the IRCd + bot are an infra addition governed by ADR-0009's dependency discipline.

## Context

The IRC feature ships as a self-hosted modern IRCd (Ergo) plus a web client (The Lounge). A member authenticates to the network over SASL with `account = userId` / `password = IRCKey` (the **IRCKey** — a per-user credential, sibling of the **AnnounceKey**). The IRCd must validate that credential somehow. Two shapes:

- **Delegated** — the IRCd calls this API on each login to validate; this API stays the sole owner of the credential.
- **Provisioned** — this API writes/updates an account in the IRCd's own credential store whenever a member sets or rotates their IRCKey; the IRCd validates locally.

This codebase's most expensive recurring failure mode is a **second source of truth drifting** from the first — the `develop ↔ main` divergence that forced the [ADR-0010](0010-trunk-based-single-branch-workflow.md) trunk fold, and the key/state drifts before it. Provisioning IRCKeys into the IRCd's store reintroduces exactly that: the same secret in two datastores, a fan-out on every rotation, and a half-failed-sync state to reconcile.

## Decision

**Delegated authentication.** The IRCd validates every SASL login by calling an **internal** stellar-api endpoint (auth-script / HTTP callback) that returns accept/reject + the resolved `userId`.

1. **Single source of truth.** The IRCKey lives in exactly one place (`User.ircKey`). The IRCd holds no credential store. Rotation is a one-row update, instantly effective — nothing to fan out, nothing to drift.
2. **Internal-only seam.** The auth endpoint is network-scoped within the compose stack and **never publicly routed**, rate-limited like any automated surface (Golden Rule 5: automated access via the API only).
3. **One validation seam, reused.** The same delegated callback later authorizes the AnnounceKey-gated **Release-Announce Feed** and bot `!commands` — one place where IRC-side credentials are checked against this API.
4. **Availability trade accepted.** If this API is unreachable, _new_ IRC logins fail; already-connected / always-on sessions persist. There is no offline-auth requirement — we do not trade the single-source guarantee for outage resilience the IRC layer does not need.

## Consequences

- **No credential mirror, no sync job, no drift** — structurally consistent with ADR-0009/0010 rather than fighting them later.
- The IRCd gains a **runtime dependency on this API at connect time**. Acceptable, and it keeps the IRCd dumb (no user database to back up, migrate, or secure separately).
- The internal auth endpoint is a **new trust boundary**: it must be network-isolated, rate-limited, and never reachable from the public surface — recorded here so it is not accidentally mounted on the public router.
- Pairs with [ADR-0012](0012-irc-activity-rollup-substrate.md) (the IRC activity substrate): together they keep IRC identity _and_ IRC-derived reputation reading from this API's own state, never from IRCd internals.
