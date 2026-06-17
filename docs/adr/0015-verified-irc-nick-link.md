# ADR-0015: Verified IRC nick link (challenge/nonce proof-of-control)

**Status:** Accepted
**Date:** 2026-06-17
**Repos:** orphic-inc/stellar-api, obrien-k/korin-pink
**Amends:** [ADR-0013 §Nick → account mapping](0013-korin-pink-irc-integration.md) — resolves its deferred "v0.2.x may add verification" clause, at v0.1.x.
**Relates:** [PRD-02 IRC & Announce](../prd/02-irc-and-announce.md), [ADR-0011 (superseded)](0011-delegated-irc-authentication.md)

---

## Context

ADR-0013 maps an IRC nick to a Stellar account via a **self-reported** `User.ircNick`
(`PUT /api/users/:id/irc-nick`) and explicitly deferred verification ("v0.1.x this is
acceptable; v0.2.x may add verification via a SASL challenge through the irc-bridge").

That trust gap is exploitable. Ergo's `force-nick-equals-account` + strict nick-reservation
mean that to _use_ nick `Alice` on IRC you must own the Ergo account `Alice` — but on the
Stellar side **any** member could set `ircNick = "Alice"` with no proof and harvest Alice's
**IRCScore**. The deferral is being pulled forward to v0.1.x to close this.

## Decision

Add **Nick Verification**: a member proves control of a claimed nick before the link
credits anything. Mechanism — challenge/nonce, **not** delegated SASL:

1. **Claim (Stellar):** `PUT /api/users/:id/irc-nick { ircNick }` creates a **Nick Claim** —
   nick + a single-use **Verification Code** (8-char human-typeable, 30-min expiry). It does
   **not** write the binding `User.ircNick`.
2. **Prove (IRC):** the member sends `!verify <code>` **in a private query** to the bridge
   bot, from the claimed nick.
3. **Relay (korin → Stellar):** the bridge → korin API `POST /irc/verify` → Stellar
   `POST /api/users/irc-nick/verify { nick, code }` (Bearer `STELLAR_SERVICE_KEY`).
   Stateless pass-through; synchronous so the bot can reply.
4. **Confirm (Stellar):** match `(fromNick, code)`, unexpired → promote the claim to a
   **Verified IRC Link** (`ircNickVerified = true`, `ircNick` set, code cleared).
5. **Gate:** the `irc` CRS dimension credits **only** a Verified IRC Link;
   `GET /by-irc-nick/:nick` resolves **only** verified links.

**Security boundary — the `(fromNick, code)` binding.** The code is matched only against the
claim whose claimed nick equals the IRC sender's nick. A leaked code is therefore useless to
anyone who doesn't already control that nick (which `force-nick-equals-account` enforces).
Code confidentiality is hygiene, not the boundary. **Trust chain:** Stellar trusts korin to
report the authenticated sender; korin trusts Ergo's authentication of the nick.

### Sub-decisions

- **A Nick Claim reserves nothing.** Multiple members may hold a claim on the same nick;
  first to verify wins the (unique) binding. An unproven assertion has zero weight — no score,
  no reservation. Claim state lives as columns on `User`, not a table.
- **No admin force-verify.** Admins may set/clear a nick (creating/clearing a claim) but
  cannot mint verified status — verification asserts Ergo-control, which an admin cannot
  assert on a member's behalf. Invariant: `ircNickVerified = true` ⟺ someone proved control.
- **Changing the nick re-enters claim state; clearing wipes it.**
- **Verified links do not expire (v1).** Staleness — a member abandons an Ergo nick that is
  later re-registered by someone else — is accepted as a narrow, low-value window (strict
  nick-reservation makes re-registration slow). Periodic re-verification is a future option.
- **No attempt lockout** (revised during implementation). A per-_claim_ counter is ambiguous
  because multiple members may claim the same nick (claims reserve nothing); a per-_nick_
  counter is griefable — an attacker spamming wrong codes for `Alice` could lock the real
  Alice out of verifying. Since the `(fromNick, code)` binding already makes brute force
  pointless and the verify endpoint is service-key-gated (korin-only, not public), a lockout
  adds a DoS surface for no real gain. Brute resistance rests on single-use codes + 30-min
  expiry + the nick binding. Failed/wrong/expired codes still get an explicit bot reply — no
  silent failure; a relay/network error does **not** consume the code (retry works).

## Considered options

- **Challenge/nonce (chosen).** Lightest path that closes the hole. Preserves ADR-0013's
  separation: korin still owns IRC identity; Stellar adds no new inbound _class_ (the verify
  endpoint is another service-key korin→Stellar call, like `by-irc-nick`/`reputation`).
- **Delegated SASL (ADR-0011, rejected again).** A per-user `IRCKey` validated by an Ergo
  auth-script down-calling Stellar on every login. Strongest, but reintroduces the
  per-login coupling and inbound-auth posture ADR-0013 deliberately removed. korin's
  `ergo.yaml` guard against reopening delegated SASL is **honored** — we add verification
  without it.

## Scope — the keys stay retired

`IRCKey`/`AnnounceKey` (ADR-0011) are **not** revived. They conflated four jobs, each now
served without a secret key:

| Old key job                           | Now served by                                                                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Identity ("this nick is this member") | the **Verified IRC Link** (this ADR)                                                                                               |
| Announce attribution                  | public metadata on the announce item                                                                                               |
| Crediting on consumption              | the session-authed accounted download (Ratio → CRS) — unchanged                                                                    |
| Private-community announce delivery   | a **separate, unmodeled** access-control feature (per-community gated channels stand on the Verified IRC Link); tracked separately |

Notably, **key-authenticated access to content via IRC is not reintroduced** — it would break
the invariant that consumption is always a session-authed, ratio-accounted download
(Golden Rule 3) and was deliberately designed out by decision #136 (notify-and-link).

## Consequences

- New columns on `User`: `pendingIrcNick` (the Nick Claim — **not** unique, so it reserves
  nothing), `ircNickNonce`, `ircNickNonceExpiresAt` (migration run interactively). The
  existing unique `ircNick` is written only on promotion and so holds **only** a verified
  value — which is why the IRCScore scorer and `by-irc-nick` need no change (both already key
  on `ircNick`, now verified-by-construction).
- New wire flow added to ADR-0013's Integration-contract table: **`verify nick`** —
  korin → Stellar `POST /api/users/irc-nick/verify` (Bearer `STELLAR_SERVICE_KEY`).
- Existing self-reported links become unverified-by-default; members re-prove to keep
  IRCScore credit (acceptable pre-launch — no production data to migrate).
