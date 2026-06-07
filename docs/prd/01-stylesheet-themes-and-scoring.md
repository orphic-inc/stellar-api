# PRD-01 — Stylesheet Themes & Adoption Scoring

**Status:** Draft · **Owner:** @obrien-k · **Related:** [ADR-0002](../adr/0002-stylesheet-injection-isolation.md), stellar-ui StylesheetInjector, [stellar-ui#65](https://github.com/orphic-inc/stellar-ui/issues/65)

> Lean PRD. Captures the decided shape and the open questions — not an exhaustive spec. Resolve the open questions before building the scoring path.

## Problem

Users want to theme their own profile and the site they browse (the `/private` universal theme). Today that's a static set of built-in stylesheets with no way for users to contribute their own look or get credit for one others adopt.

## Goals

- Let users select a site/profile theme from built-in **and** user-supplied stylesheets.
- Let a user publish their own stylesheet (via profile `externalStylesheet`) and earn recognition when others adopt it.
- Make good themes socially visible (contests / leaderboards) without compromising site safety.

## Non-goals

- A full CSS editor in-app (users supply a URL for now).
- Per-page / per-route theming (theme is account-level).

## Feature shape (decided)

1. **Built-in themes:** `kuro`, `layer-cake`, `postmod`, `proton`, `sublime`.
   - **Sublime is the base/default theme**, _and_ a seeded selectable option, _and_ the reference design the contest feature is modeled on. It is the **reset target** for the injector's global-CSS-reset. (Authoring tracked separately — net-new, never written.)
2. **User profile stylesheet:** `profile.externalStylesheet` — a URL, validated (`z.string().url()`, restored in stellar-api). Applied site-wide via the stellar-ui **StylesheetInjector**, which wraps user CSS in a **global reset boundary** so a user stylesheet cannot leak into / break the app chrome.
3. **Adoption scoring:** when user A _sets_ user B's published stylesheet as their active theme, community-score accrues — **adopter (A) +10, author/supplier (B) +100**. The heavy author bonus is the incentive to design good themes.
4. **Contests:** periodic stylesheet contests layer on top of the adoption signal (bonus incentive).

## Open questions (resolve before building scoring)

- **🔴 Anti-abuse on the +100 author bonus.** As specified it's a self-dealing magnet (sockpuppet adopts author's sheet → farm +100/puppet). Candidate controls — _unanswered, needs a decision:_
  - unique-adopter-only (one accrual per distinct adopter)
  - per-author cap / diminishing returns
  - staff-curated contest rounds gate the bonus
  - accrual only above an adoption threshold / for accounts past some trust bar
  - This likely warrants its own ADR once chosen.
- **Score computation model.** Computed-on-read (per the LinkHealth/community-health-pulse approach) vs. materialized? Affects where adoption events are counted.
- **Injection safety.** Sanitization/sandboxing of user-controlled CSS + the reset boundary — see ADR-0002.

## Cross-repo surfaces

- **stellar-ui:** `StylesheetInjector.tsx` (+ spec, global reset), theme selector, `src/stylesheets/<theme>/`.
- **stellar-api:** `profile.externalStylesheet` validation, community-score adoption accrual, contest endpoints.

## Out-of-band but related

- [stellar-ui#65](https://github.com/orphic-inc/stellar-ui/issues/65) — human-friendly contribution file-size input (contribution flow, not theming; cross-linked only because it surfaced in the same pass).
