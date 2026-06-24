# Stylesheet injection isolation & sanitization

**Status: Accepted, amended 2026-06-23.** Records the isolation + sanitization strategy for user-supplied stylesheets; see [PRD-03](../prd/03-stylesheet-themes-and-scoring.md). Resolves decision [#130](https://github.com/orphic-inc/stellar-api/issues/130). (ADR-0002 is reserved for community-health-pulse, [#75](https://github.com/orphic-inc/stellar-api/issues/75).) **Arm 1 (protected-chrome isolation) is superseded — see the [Amendment](#amendment-2026-06-23-arm-1-dropped-themes-are-visually-unrestricted) at the bottom; the boundary is now code-injection only (Arm 2).**

## Context

User-supplied stylesheets — an inline-stored `AuthorStylesheet.source` (raw CSS) and a `profile.externalStylesheet` URL — are injected site-wide by stellar-ui's `StylesheetInjector`. This is a trust boundary: an unscoped sheet can break or visually hijack app chrome (hide moderation/admin controls, clickjack) or carry an exfiltration vector (`@import`, `url()`, `@font-face` firing requests to arbitrary hosts). The URL is format-validated (`z.string().url()`) and `source` is length-capped (100 KB), but neither is a safety control. The `/private/` invite-only model mitigates but does not eliminate the threat (a compromised or malicious member).

The product goal is **site-wide** theming — the theme must cascade into the real DOM — which rules out sandboxing the theme away from the app.

## Decision

A two-arm, defense-in-depth boundary.

### Arm 1 — Isolation: a protected-chrome layer, not a sandbox — **SUPERSEDED (see Amendment)**

> Superseded 2026-06-23. Retained for the record; **not implemented**. A sandbox (iframe / shadow DOM) remains rejected for the same reason (it can't theme the app's own chrome). Original text follows.

User CSS is injected into the real document so theming works, but **critical app chrome** (primary navigation, staff/admin and moderation controls) is rendered inside a high-priority CSS `@layer` and/or an `all: revert` reset container that user sheets cannot override. Themeable regions accept the cascade; chrome is locked. This is the "Global SCSS/CSS reset flag" PRD-03 anticipates. A sandbox (iframe / shadow DOM) is **rejected**: it can only theme content inside the sandbox and cannot theme the app's own chrome, which defeats the feature.

### Arm 2 — Sanitization & fetch: clean at ingestion, constrained at injection

- **Store-time (server, the ingestion path):** `AuthorStylesheet.source` is sanitized **before it is persisted** — `@import` stripped, and `url()` / `@font-face src` constrained to an allowlist or `data:` URIs — so the stored artifact is already safe (fail-closed, matching the API's posture). `source` is treated as **plain CSS**; server-side compilation of untrusted SCSS is out of scope.
- **Inject-time (UI + headers):** a Content-Security-Policy backstops the injector — `style-src 'unsafe-inline'` for the theme, with `img-src` / `font-src` / `connect-src` locked so any construct the store-time pass misses still cannot exfiltrate.
- **ExternalStylesheet URL:** the same fetch constraints (host allowlist / CSP) apply; an authorless or dead external URL is a prune/investigate + link-health concern (PRD-03), not a render-time trust grant.

## Consequences

- **#145 changes before merge:** the AuthorStylesheet ingestion path gains a store-time CSS sanitizer; it does **not** merge storing raw `source`.
- `source` is plain CSS at the boundary; the SCSS-vs-stored-file shape question in PRD-03 narrows to CSS-in, with any authoring-time SCSS compilation happening client-side before submission.
- The injector spec (PRD-03 descent target #5, stellar-ui) asserts the injection path is code-injection-safe + the CSP — the UI half of this boundary. (Originally also asserted a chrome layer; see Amendment.)
- Defense-in-depth: a bypass must defeat both the store-time sanitizer and the CSP.

## Amendment (2026-06-23): Arm 1 dropped — themes are visually unrestricted

Building the stylesheet boundary in stellar-ui (#73) proved Arm 1 unworkable **and** unwanted, so it is dropped:

- **CSS cannot enforce it.** Cascade layers tame only _normal_ declarations. A theme shipping `display:none !important` defeats every arrangement — a layered lock loses (for `!important` the layer order reverses, so a lower/earlier layer wins), and unlayered `!important` is the _weakest_ important origin. Verified in a real browser: unlayered, earlier-layer, and later-layer locks were all overridden. Any sheet we agree to inject into the real DOM can override chrome; `!important` makes that absolute.
- **Product call:** themes should be able to do more or less anything visually — maximal theming freedom is the feature. The only thing we defend is **code injection** (XSS, exfiltration), not visual override of chrome. Hiding your own nav is a cosmetic choice, not a security boundary.

The boundary is therefore **Arm 2 only**, realized as:

- **Store-time sanitization** (API, `lib/cssSanitize.ts`): strips `@import` and constrains `url()` / `@font-face src` to `data:` / same-origin, so persisted author CSS can't fetch arbitrary hosts.
- **Inject-time CSP** (stellar-ui, prod builds, via HtmlWebpackPlugin): permissive on resource axes (`style-src`/`img-src`/`font-src`/`connect-src`) to keep theming freedom, strict on execution (`script-src 'self'`, `object-src 'none'`, `base-uri`/`form-action 'self'`) — the real XSS gate. `frame-ancestors` needs a response header (tracked separately).
- **Injector** stays a plain `<link href>` for URL themes (no CSS-injection surface; http(s) scheme gated), and future author raw CSS is injected as already-sanitized `<style>`.

No `data-stellar-chrome` markers, no chrome `@layer`. A bypass must defeat the store-time sanitizer and the CSP — there is no chrome layer in the model.
