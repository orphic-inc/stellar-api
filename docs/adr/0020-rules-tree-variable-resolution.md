# ADR-0020: Read-time variable resolution for the Golden Rules tree

**Status:** Accepted (2026-06-22)
**Date:** 2026-06-22
**Repos:** orphic-inc/stellar-api, orphic-inc/stellar-ui (+ external obrien-k/korin-pink)
**Relates:** [ADR-0018 — development lifecycle & the API/UI contract gate](0018-development-lifecycle-and-contract-gate.md)
**Implements:** [PRD-09 — Golden-Rules Surfacing](../prd/09-golden-rules-surfacing.md), extending [PRD-05 — Rules & Governance](../prd/05-rules-and-governance.md)

---

## Context

The six Golden Rules have a canonical prose home (`CODE_OF_CONDUCT.md`) and a data substrate (the `Rule`/`SubRule` tree shipped in #123, read via `GET /api/rules/tree`), but the two were never connected and the prose's `${...}` placeholders resolved nowhere. To surface the rules to end users we had to decide, once, where those placeholders get resolved — because the choice determines whether values get duplicated across repos, which is the exact drift the single-source effort exists to avoid.

The prose carries three kinds of dynamic reference: configuration values (`${site_name}`, `${irc}`, `${disabled_channel}`), UI routes (`${staffpm}`, and `${irc}` rendered as a nav link), and links to seeded or external content (the `${*_article}` guidance pages, the internal feature references, and the Bugs forum). The stored rule bodies must remain **verbatim** so `CODE_OF_CONDUCT.md` stays the single authored source and a CI drift-guard can byte-compare the two; resolution is therefore necessarily a read-time concern layered over the stored tree, not a stored value.

Three options were on the table. (A) The API ships the verbatim tree plus a resolved `variables` map and the UI substitutes. (B) The API fully resolves every token server-side and emits final text/markdown, leaving the UI a dumb renderer. (C) The UI owns both the values and the substitution, with the API returning raw tokens only.

## Decision

Adopt **option A**: `GET /api/rules/tree` returns `{ rules, variables }`, where `rules` is the verbatim tree (tokens intact) and `variables` is a token → value map resolved server-side by `resolveSiteVariables()` (`src/modules/siteVariables.ts`) from `config.site` plus a name lookup for the id-based Bugs forum. The UI performs the mechanical substitution and owns presentation per token.

The API is the **single source of the values** (no cross-repo duplication, which kills the drift in option C), while the **UI keeps presentation control** — it can render `${irc}` as a real nav component and `${*_article}` as an anchor with its own link text, which option B's pre-baked markdown anchors cannot. Token classes: text tokens (`site_name`, `disabled_channel`) substitute in place; route/URL tokens are wrapped by the UI. Public-guidance articles resolve under the **Stellar Public KB** (`STELLAR_PUBLIC_KB_BASE`), a public-facing wiki peer to IRC; app-feature references resolve to internal wiki routes; the rules prose carries **no external third-party links**.

The stored bodies stay verbatim; `src/modules/goldenRules.ts` (`GOLDEN_RULES` + idempotent `seedGoldenRules()`) mirrors the prose and `src/modules/goldenRules.spec.ts` drift-guards it against `CODE_OF_CONDUCT.md`.

## Consequences

- Adding/renaming a token is a two-line change in `siteVariables.ts` + the prose; the contract is the `variables` map shape, registered in `src/lib/openapi.ts` (`{ rules, variables }`) so the API/UI contract gate (ADR-0018) covers it.
- The UI must implement substitution and per-token presentation; until it does, the rules render with literal `${...}` tokens visible. This is the downstream stellar-ui work.
- Config values (`STELLAR_SITE_NAME`, `STELLAR_IRC_URL`, `STELLAR_DISABLED_CHANNEL`, `STELLAR_STAFFPM_PATH`, `STELLAR_PUBLIC_KB_BASE`) are all optional with sane defaults — the endpoint never fails closed on a missing variable.
- `${bugs_forum}` depends on the seeded Bugs forum existing; absent it, the resolver falls back to `/forums`. The `/forums/:id` route shape is assumed against stellar-ui and noted as an open confirmation in PRD-09.
- CRS micro-impact magnitudes remain PRD-05 TBD; seeded weights are `0`, so resolution and scoring evolve independently.
