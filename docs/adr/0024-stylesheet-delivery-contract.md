# Stylesheet delivery contract — external URL + registry serving

**Status: Accepted (decided 2026-07-02, status recorded 2026-07-19 — the line was never updated after the code shipped; nothing in the ADR was left unresolved).** Resolves PRD-03's open decision "AuthorStylesheetUrl storage shape (URL vs stored file) — pending ExternalStylesheet findings" and repairs the severed adopt→display pipe (adoption writes `activeAuthorStylesheetId`; nothing renders it). Companion UI decision: [stellar-ui ADR-0008](https://github.com/orphic-inc/stellar-ui/blob/main/docs/adr/0008-registry-stylesheet-injection.md) (injector third branch). Rides on the injection-safety boundary of [ADR-0003](0003-stylesheet-injection-isolation.md). (ADR number 0024 is next free on `main`.)

## Context

A member customizes the site through the Site Stylesheet slot (PRD-03), fed by one of two sources the settings UI presents as a bifurcated radio:

- **Personal** — a self-hosted external URL (`UserSettings.externalStylesheet`).
- **Registry** — a stylesheet stored on the platform (`AuthorStylesheet.source`), authored by the member or adopted from another author.

Today only Personal renders. Adoption sets `UserSettings.activeAuthorStylesheetId` (`authorStylesheet.ts`), but the pointer is not in `PROFILE_BASE_SELECT`, not in the OpenAPI contract, and the injector has no branch for it. Authored sheets are raw text with no `text/css` delivery route, and the injector is `<link href>`-only by design (ADR-0003: an `href` carries no CSS-injection surface).

## Decision

### 1. Registry sheets are delivered as CSS by the API — source never leaves as a stylesheet payload except through this route

New route: `GET /api/stylesheet/author-stylesheet/:id/css` → `200`, `Content-Type: text/css; charset=utf-8`, body = the stored (already store-time-sanitized, ADR-0003 Arm 2) `source`. `Cache-Control: no-cache` first pass (revalidate; sheets are mutable). `X-Content-Type-Options: nosniff` per API default headers.

The injector stays a pure `<link href>` — the Registry branch links this route, same as Personal links an external URL. No `<style>` text injection path is added in stellar-ui; a single delivery mechanism keeps the ADR-0003 boundary one-shaped.

The existing JSON read (`GET /author-stylesheet/:id`) continues to return `source` for editing (author + staff use). Registry listings return metadata only (id, authorId, name, timestamps) — no `source` in list payloads.

### 2. The user contract is plain CSS — SCSS is rejected as user input

PRD-03's "a user-authored `.scss`/`.css`" is amended to `.css` only at both sources:

- **Registry:** `authorStylesheetSchema.source` is treated as plain CSS (already true — the sanitizer parses CSS, not SCSS). Accepting SCSS would mean compiling untrusted input server-side, which ADR-0003 explicitly scopes out, plus a runtime `sass` dependency whose version drift becomes part of the security surface. Rejected.
- **Personal:** the URL must serve CSS the browser can consume directly; we do not fetch, compile, or transform it.

SCSS remains an internal build-time convenience for first-party themes in stellar-ui (the legacy-CSS→SCSS conversion). It compiles to CSS before it ever touches this contract. Authors who prefer SCSS compile it themselves — same as every browser-facing stylesheet on the web.

### 3. External URLs: `https:` only, end to end

- **API:** `profileSettingsSchema.externalStylesheet` / `userSchema` tighten from `z.string().url()` to an https-only refinement (`.url()` alone admits `ftp:`/`javascript:` — valid URLs the UI will never render; saves that silently no-op are a contract lie).
- **UI:** `isInjectableUrl` drops `http:` (prod CSP `style-src … https:` blocks it anyway, as does mixed-content; the allowance is dead code that reads like a promise).

Dead/unreachable externals stay a link-health concern (PRD-03: dead-external penalty, [#122](https://github.com/orphic-inc/stellar-api/issues/122)) — not validated at save time.

### 4. The pointer joins the profile contract; the radio replaces "override" semantics

- `activeAuthorStylesheetId` is added to `PROFILE_BASE_SELECT` and the OpenAPI profile schema.
- Settings presents Personal / Registry as mutually exclusive (radio). Selecting one clears the other (`externalStylesheet = null` ⟷ `activeAuthorStylesheetId = null`). This retires the current "if set, this URL overrides" implicit-precedence text — one slot, one explicit source. The invariant is enforced server-side on the profile write (a non-radio client cannot set both); the UI radio mirrors it.
- Injector precedence becomes: explicit slot value → `siteAppearance` (built-in) → Sublime default. No stacking.

### 5. Registry spaces are the rank-gated count limit — one concept, one name

"Higher tier users get more registry spaces" is the already-deferred rank-gated `AuthorStylesheet` count limit ([#146](https://github.com/orphic-inc/stellar-api/issues/146)); donor-added spaces are PRD-07 $tylesheets. This ADR names the concept **registry spaces** and reserves it — distinct from PRD-03 **slots** (Site/Profile/Community render slots), which are a different axis. Do not overload "slot."

First pass ships with the limit unenforced (status quo); #146 implements the gate. Gallery/browse UX is out of scope (later pass; adoption is by direct reference until then).

## Consequences

- Repairs the display half of the adopt path: adopt → pointer → contract → injector → `text/css` route. E2E: seed author `Stellarfic`, author the `anorex` source through `POST /author`, adopt from a second user, assert the `<link>` lands and the sheet applies. (`anorex` currently ships only as a static file in stellar-ui with no seed row — unselectable. Once it becomes the registry fixture, the static file is demoted to test fixture input or removed: the stored row is canonical, no silent duplicate.)
- The "contest winner → official registry promotion" path (Stellarfic story) becomes mechanical later: promotion = staff creating a site `Stylesheet` row whose `cssUrl` is this ADR's `/css` route for the winning sheet. Named here, not built.
- Serving user CSS from the API origin puts author sheets under `style-src https:` (prod) — no CSP change needed; dev proxying already routes `/api`.
- PRD-03 edits ride along: amend `.scss/.css` → `.css` (§ Ubiquitous Language, § External disposition), close the open decision (storage shape = stored `source`, API-served; `AuthorStylesheetUrl` as a distinct URL-typed registry entry is dropped — Personal covers the URL case), and record the radio UAT flow.
- stellar-api's `schemas/stylesheet.ts` and `lib/cssSanitize.ts` comments still cite the superseded ADR-0003 Arm 1 chrome layer — corrected in the same docs pass. (Verified done 2026-07-19: both now describe Arm 1 as dropped and name the CSP as the boundary's other half.)

## Rejected

- **`<style>` text injection in the UI** — a second delivery shape, a second thing to audit; the link route is sufficient and keeps ADR-0003's "href, never CSS text" invariant.
- **User-facing SCSS (compile-on-ingest or compile-on-serve)** — untrusted compilation surface + runtime dep; ADR-0003 scope-out stands.
- **Fetching/validating external URLs at save time** — an SSRF surface for a liveness check link-health already owns.
