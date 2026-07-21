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

The existing JSON read (`GET /author-stylesheet/:id`) continues to return `source` for editing (~~author + staff use~~ — see the 2026-07-19 amendment below: this parenthetical describes an access control that never shipped and cannot be enforced; the read is open to any authenticated member). Registry listings return metadata only (id, authorId, name, timestamps) — no `source` in list payloads.

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

~~First pass ships with the limit unenforced (status quo); #146 implements the gate.~~ #146 shipped the gate; its semantics are corrected by [ADR-0032](0032-authored-stylesheet-member-lifecycle.md) §4 (max across primary + secondary ranks, `0` means unlimited). ~~Gallery/browse UX is out of scope (later pass; adoption is by direct reference until then).~~ ADR-0032 §1 makes direct reference the decision rather than the interim state — there is no later pass, and no browse endpoint ships.

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

## Amendment (2026-07-19) — addressing, and why it differs from the asset store

Decides [#350](https://github.com/orphic-inc/stellar-api/issues/350) on the [authored-stylesheet wayfinder map](https://github.com/orphic-inc/stellar-api/issues/347). The asset store ([ADR-0026](0026-static-asset-storage.md)) deliberately went content-addressed while this route serves sequential ids behind `requireAuth`, and the difference had no recorded reason — so it read as an oversight in a subsystem where the two paths will eventually sit adjacent serving the same themes.

**Sequential ids stay. The asymmetry is provenance and mutability, not secrecy.**

### Adoption tracks edits, so identity must be stable

When an author edits an adopted sheet, every adopter sees the edit. The pointer (`UserSettings.activeAuthorStylesheetId`) names a stable identity whose content varies, which is what §1's `Cache-Control: no-cache` has assumed since this ADR shipped.

Content-addressing is the opposite arrangement: the address _is_ the content, so it changes on every save, and every pointer at the sheet goes stale — each adopter's `activeAuthorStylesheetId` plus the registry row's `cssUrl`. Making a mutable resource content-addressed requires an indirection layer mapping stable identity to current hash, and that layer is the sequential id. It adds a hop to arrive where we started.

This also runs the other way: [#351](https://github.com/orphic-inc/stellar-api/issues/351) decided `seedStylesheetFixtures` must propagate `source` on update, so a built-in theme's bytes change while its address holds. Content-addressing would rewrite every registry `cssUrl` on every fixture edit.

### There is no confidentiality boundary here to defend

An earlier reading held that enumerating ids leaks only metadata because the route is authed. That is wrong, and the correction matters: neither `GET /author-stylesheet/:id` nor `/css` is ownership-scoped (`getAuthorStylesheetById` is a bare `findUnique`), so any authenticated member can walk the ids and read every sheet's full `source`.

That is **acceptable, and not fixable by addressing**. `/css` must serve non-authors or adoption cannot work — the adopter's browser is what fetches the sheet. An unguessable address is a capability, and this capability is published in a `<link>` in every adopter's DOM the moment the sheet is adopted. Authored stylesheets carry no confidentiality expectation.

Consequently §1's "(author + staff use)" is struck as never-implemented and unenforceable, rather than treated as a gap to close. The list-payload exclusion of `source` stands as a payload-size measure, not a confidentiality control — the ids it returns lead straight to the bytes.

### Why `/css` keeps `requireAuth` while `/api/asset/:hash` does not

- **`/api/asset`** serves site-shipped bytes reviewed in the repository — `putAsset` is reachable only from the seeder, which [ADR-0031](0031-injected-css-threat-model.md) §4 relies on normatively. Public and immutable by construction, so auth buys nothing over the address, and `Cache-Control: immutable` is literally true.
- **`/css`** serves member-authored, mutable content. "No confidentiality expectation" is scoped to _members of an invite-only instance_ — the instance boundary, not the open internet. Dropping auth would publish every member's authored CSS to anyone holding a URL.

So content-addressing follows from **immutability**, which is what makes it possible, not from secrecy, which it does not provide. Enumerability is a side effect of the sequential form, not a weakness the asset route was designed to avoid; `src/routes/api/asset.ts` is corrected to say so.

### Consequence for promotion (recorded, not decided here)

§5 above defines contest-winner promotion as staff creating a `Stylesheet` row whose `cssUrl` points at the winning sheet's `/css` route. Combined with "adoption tracks edits", that would leave a promoted theme editable by its original author _after_ it became site-official — the first built-in whose bytes live under member control, and a case where the reviewed artifact is not the served artifact.

Promotion therefore **copies** the source into a System-owned row rather than pointing at the author's live row, matching how the ten built-in fixtures already work. Noted against [#258](https://github.com/orphic-inc/stellar-api/issues/258), which owns the promotion lifecycle.

## Amendment (2026-07-19b) — one delivery mechanism, and the enforcement this ADR never had

Decides [#354](https://github.com/orphic-inc/stellar-api/issues/354) on the [authored-stylesheet wayfinder map](https://github.com/orphic-inc/stellar-api/issues/347). Completes the Consequences bullet above, which said of the `anorex` static file: "the stored row is canonical, no silent duplicate." That rule was written, never enforced, and violated within a release.

### The evidence: four dead directories

Charting the registry against stellar-ui's `src/stylesheets/` found the rule already broken in both directions nobody was looking:

| Theme                                                                     | Registry `cssUrl`                               | ui static dir               | Reality                                                                     |
| ------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------- | --------------------------------------------------------------------------- |
| `anorex`, `kuro`, `layer-cake`                                            | `/css` (reconciled by `seedStylesheetFixtures`) | present                     | Unreachable — shipped to every user, referenced by nothing                  |
| `dark-ambient`, `shiro`, `mono`, `minimal`, `hydro`, `bubblegum`, `white` | `/css`                                          | absent                      | Clean                                                                       |
| `sublime` (`isDefault`)                                                   | `/stylesheets/sublime/style.css`                | present, rule-free          | `cssUrl` is a fiction — see below                                           |
| `proton`                                                                  | `/stylesheets/proton/style.css`                 | 24K + images                | Live; [#341](https://github.com/orphic-inc/stellar-api/issues/341)'s target |
| `postmod`                                                                 | `/stylesheets/postmod/style.css`                | 756K, four commercial fonts | Live; gated on [#343](https://github.com/orphic-inc/stellar-api/issues/343) |

The seeder upserts each fixture's registry row by name and reconciles `cssUrl` to the `/css` route, so three themes silently moved to api delivery while their static files kept shipping. Nothing detected it, because the one guard that exists (`stylesheetRegistry.integration.ts`) asserts only that `/css`-backed rows resolve — a row pointing outside the api is invisible to it.

### 1. Asset-bearing themes migrate; bundling is not a second class of theme

Bundling's claimed advantages are integrity, versioning with the app, and no runtime fetch. The first two are already available to fixtures — the CSS is checked into `prisma/seed-assets/`, ships in the image, and #341's design pre-rewrites every `url()` to `/api/asset/<sha256>`, which is stronger integrity than a bundled file gets. The third is real and cheap.

What decides it is the table above. A second delivery mechanism is not free to keep dormant; its cost is drift that nothing detects, and that cost has already been paid once.

Note for #341: its stated hard blocker (#340, the sanitizer mangling `proton`'s 54 escaped Tailwind identifiers) is **dissolved by construction** — [ADR-0031](0031-injected-css-threat-model.md) §5 stores bytes verbatim, so `proton` round-trips regardless. `postmod` remains gated on #343, and this ADR sharpens that question rather than answering it: migration moves those fonts from a private ui bundle to `/api/asset/:hash`, which is **unauthenticated** by design (see the 2026-07-19 amendment above). #343 is therefore not "may we bundle these" but "may we publish these".

### 2. `/stylesheets` serving is retired, not left dormant

`anorex`, `kuro`, `layer-cake` and `sublime` are deleted from stellar-ui immediately — all four are provably unreachable and none waits on a migration. `proton` follows #341; `postmod` follows its own migration. `common/global.css` is the theming contract (role tokens and `data-st` hooks, ui ADR-0005), not a theme: it reaches the app by `import` at `index.tsx:9`, not through the static tree, and moves out of `src/stylesheets/` rather than becoming the last tenant of a directory that exists for a retired mechanism.

`postmod` is consequently the last thing holding the mechanism open. When it leaves, webpack's `CopyPlugin` entry and the devServer `static` entry go with it. Dormant is the state that produced this amendment; the end state is gone.

### 3. Sublime models "renders nothing" as data, not as a name the UI recognises

`sublime` ships no CSS rules by design — the bundled Tailwind defaults _are_ Sublime — and, at the time this was decided, `StylesheetInjector.tsx` hardcoded `if (!siteAppearance || siteAppearance === 'sublime') return null`, so its `cssUrl` was a path nothing ever requested. (That comparison is gone; see **UI half landed** below.)

**`Stylesheet.cssUrl` becomes nullable; `null` means the row has no delivery target.** Sublime keeps `isDefault` and its picker entry, and the injector links nothing because the row says so rather than because it recognises a string. This retires a cross-repo magic string paired with `getDefaultStylesheetName`'s `?? 'sublime'` fallback — the same shape that already drifted on the seeded-avatar sentinel.

Seeding Sublime as an empty `/css` fixture was rejected: it buys uniformity by making the default theme depend on an authenticated fetch to receive nothing, and `/css` requires auth while the default must work for everyone.

**UI half landed (2026-07-21).** [stellar-ui#196](https://github.com/orphic-inc/stellar-ui/issues/196) removed the `siteAppearance === 'sublime'` comparison ([ui#200](https://github.com/orphic-inc/stellar-ui/pull/200)), so §3 now describes shipped behaviour on both sides: the injector resolves Sublime through the registry like any other row and links nothing because `cssUrl` is null. Two effects beyond deleting the string, both consequences of the comparison having short-circuited _ahead_ of the injector's "queries still loading" guard — an operator who repoints Sublime at a real delivery target now gets it honoured (which this ADR's migration deliberately preserves by conditioning on the old dead value), and a Sublime user's pre-applied `<link>` is no longer torn down mid-load.

Note the retirement is **half** done, not complete: the paragraph above says this "retires a cross-repo magic string paired with `getDefaultStylesheetName`'s `?? 'sublime'` fallback", but only the UI side of that pair is gone. The api-side fallback is still in place, deferred to [#376](https://github.com/orphic-inc/stellar-api/issues/376) — see the closing paragraph of the amendment below.

### 4. The guard becomes a total partition

`stylesheetRegistry.integration.ts` is extended so that **every** registry row is either `/css`-backed or has a null `cssUrl`, and nothing else is legal. A future row pointing outside the api then fails CI on the way in.

§3 is what makes this expressible. With Sublime carrying a fictional `cssUrl`, the assertion needs an exception carved by name — and an exception list is exactly where the next `proton` hides. A light stellar-ui check that the theme tree stays empty is secondary: the api guard catches the failure that matters (a row nobody can serve), while the ui one catches dead bytes in a bundle, which is cheaper to be wrong about.

**Known seam, recorded not closed.** Neither guard is cross-repo. The api cannot see stellar-ui's tree and the ui cannot see the registry, so adding `src/stylesheets/newtheme/` without touching the api still fails silently — which is precisely today's failure. Do not mistake the api guard for full coverage.

## Amendment (2026-07-20) — what the shipped guard actually reaches

§4 above says a future row pointing outside the api "fails CI on the way in". Implementing it (#371) established that this is true of _seeded_ rows only, and the gap is worth recording next to the claim rather than leaving the stronger reading in place.

`stylesheetRegistry.integration.ts` truncates in `beforeEach`, so the partition is asserted over rows the tests seed — `seedStylesheetFixtures` output plus rows a test creates directly. It never inspects the registry a real `prisma migrate deploy` produces. A SQL data migration that inserts a `/stylesheets/…` row therefore still passes CI, which is the same class of vector that produced this amendment: the 2026-05-24 seed migration and `20260524200000_add_legacy_stylesheets` are exactly how the dead rows arrived.

**`postmod` is that case today.** It is planted by migration, is not a seeded fixture, and stellar-ui still serves it — §2 above records it as the last thing holding `/stylesheets` open, gated on [#343](https://github.com/orphic-inc/stellar-api/issues/343). So the registry on a live database is _not_ a total partition right now, and no guard reports it. This is accepted rather than papered over: excluding `postmod` by name would be the exception list §4 exists to avoid, and failing CI until #343 clears would block unrelated work behind a licensing decision.

The sequencing that closes it: #343 retires `postmod`, the partition becomes true of the shipped registry rather than only the seeded one, and the guard can then be extended to run against a migrated database. Until then, read §4's guarantee as covering seeding and fixtures — not migrations.

Two adjacent gaps, both ticketed rather than fixed here: the write path (`POST`/`PUT /api/stylesheet`) accepts a null `cssUrl` but does not enforce the partition at runtime, so a strict-admin can still create an unservable row; and `getDefaultStylesheetName`'s `?? 'sublime'` fallback — named in #371 as half of the magic-string pair — is untouched, because retiring it makes `siteAppearance` nullable and is a materially larger change than the delivery contract.
