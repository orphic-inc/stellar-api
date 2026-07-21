# ADR-0026: Static asset storage for themes and content imagery

**Status:** Accepted (2026-07-07)
**Relates:** [ADR-0024](0024-stylesheet-delivery-contract.md) (stylesheet delivery contract — the `/css` route this ADR complements), stellar-ui ADR-0005 / `docs/theming.md` (the token contract that makes recolor themes asset-free), and the built-in stylesheet fixtures shipped in 0.6.3 (#285, #286).

## Context

ADR-0024 made the stored, sanitized `AuthorStylesheet` source the canonical delivery artifact for a registry theme, served by `GET /api/stylesheet/author-stylesheet/:id/css`. That route carries **only CSS bytes** — there is no companion path for a theme's co-located assets (background images, web fonts, sprites). It works for token-only themes (stellar-ui ADR-0005), which are a `:root { --st-* }` block with no `url()` and no bundled files; the two built-in fixtures shipped in 0.6.3 (`anorex`, `dark-ambient`) are asset-free by design for exactly this reason.

But two forces make a real asset story unavoidable:

1. **The asset-bearing themes can't migrate.** The pre-contract themes still shipped as static files under stellar-ui (`postmod`, `proton`) carry `@font-face` and `url('./images/…')` against a co-located `images/` directory served next to their `style.css`. They cannot move to the api-canonical `/css` model until their assets have somewhere to live — so today the registry is split: two themes api-canonical, the rest ui-static. That split is a stopgap, not the end state ADR-0024 describes.

2. **Content imagery will be plentiful.** Cover art, avatars, community/theme logos, and similar user- and staff-supplied images are coming, and each is the same shape of problem: a binary asset that a stored row references but the api has no first-class way to store, serve, or garbage-collect. Wedging each into an ad-hoc route (or leaning indefinitely on the stellar-ui static tree) rebuilds the cross-repo drift that #285/#286 set out to end — a reference in one repo whose target lives, unverified, in another.

This ADR fixes the **decision** to build a general static-asset store; the implementation is deferred to a tracked follow-up (it does not block the 0.6.3 cut, whose themes are asset-free).

## Decision

Introduce an api-owned asset store as the single home for binary assets a stored row references, so an asset — like a stylesheet's canonical source — is verifiable from the api that serves it. The shape below is accepted; the implementation is tracked as a separate `feat` issue that settles the remaining concrete choices (marked).

The parameters the implementation fixes:

- **Storage backend.** An object store (S3-compatible / MinIO) is the scalable default for "plentiful"; a mounted volume or a DB-blob table are simpler but bounded. Pick one, with the connection surfaced through `config.ts` and degrade-closed when unset (mirroring the korin integration pattern).
- **Model + serve route.** An `Asset` row (id, content hash, mime, size, owner, kind) plus a content-addressed serve route (`GET /api/asset/:id` or by hash) with correct `Content-Type` and long-lived caching (assets are immutable once stored, unlike the mutable `/css` sheet).
- **Ingest + safety.** Store-time validation of mime/size, an upload path gated like the existing author-sheet write, and the same fail-closed posture as `sanitizeStylesheetSource` — the store never serves an unvalidated byte.
- **Theme assets specifically.** Once the store exists, an asset-bearing theme's `url()` targets resolve to `/api/asset/…`, letting `postmod`/`proton` (and any future rich theme) become api-canonical `/css` fixtures — closing the registry split above.
- **Lifecycle.** Reference counting or an orphan sweep so a deleted row's assets don't leak (the `AuthorStylesheet` → owner cascade is the precedent to extend).

## Consequences

- **0.6.3 is unblocked** — its built-in themes are token-only, so nothing here gates the cut; this ADR only records the plan the `/css` model forces.
- **The registry split becomes temporary by design** — `postmod`/`proton` stay ui-static with a named path to api-canonical once the store lands, rather than an open question.
- **A new subsystem to own** — storage, a serve route, ingest safety, and lifecycle are real surface; the follow-up must scope them deliberately rather than growing a route per asset kind.
- **Cross-repo drift keeps shrinking** — moving binary assets into an api-verifiable store extends the #285/#286 single-source-of-truth move from CSS to imagery.

## Amendment (2026-07-19) — the parameters, fixed

The store landed as #290 Phase 1. The choices this ADR left marked are now settled:

- **Storage backend: a Postgres `Bytes` column**, not the object store named above as the scalable default. The api container has no writable volume and compose lives in a separate repo behind the [ADR-0027](0027-publish-vs-deploy-boundary.md) publish/deploy boundary, so a filesystem or S3 backend would not have worked anywhere until a cross-repo change landed — the feature would have shipped inert. Postgres is already the only stateful service and already covered by its bind mount, so the store inherits backup and lifecycle for free. This is deliberately bounded: it is right for theme imagery and wrong once content imagery is measured in gigabytes. `src/modules/assetStore.ts` is a two-function seam (`putAsset` / `getAssetByHash`) so a driver swap replaces bodies, not callers.
- **Address: the content hash, not the row id.** `GET /api/asset/:hash` resolves a sha256. This makes the route non-enumerable (unlike the sibling `/css` route's sequential ids), makes `Cache-Control: immutable` literally true, and collapses duplicate bytes to one row.
- **The serve route is unauthenticated.** Phase-1 assets are site-shipped theme imagery fetched as CSS subresources; an auth round-trip buys nothing over non-secret bytes at an unguessable address. Private user-uploaded assets are a Phase-2 concern and get an explicit visibility column and a gate then — this is not a standing licence to serve anything.
- **Ingest is validate-and-reject.** `src/lib/assetValidate.ts` identifies a payload by magic bytes, cross-checks any declared mime against them, and throws. This inverts `sanitizeStylesheetSource`'s cleanse-don't-reject signature on purpose: you can neutralize a `url()` and still have valid CSS, but there is no partial-clean of an arbitrary binary. The fail-closed intent carries; the signature does not.

  **Note (2026-07-19, decided on [#351](https://github.com/orphic-inc/stellar-api/issues/351)):** the contrast drawn above no longer holds. [ADR-0031](0031-injected-css-threat-model.md) §5 replaced the cleaning sanitizer with a detector that rejects and stores bytes verbatim, so the two safety validators **converge** on validate-and-reject rather than inverting. CSS did not keep a partial-clean path: decoding a whole sheet in order to match it is precisely what persisted mangled bytes ([#340](https://github.com/orphic-inc/stellar-api/issues/340)), so the cleansing signature was retired as a class rather than repaired. The paragraph above is retained as the record of why the two diverged when this ADR was written. [#360](https://github.com/orphic-inc/stellar-api/issues/360) renames `sanitizeStylesheetSource` to `cssValidate` so the identifier stops asserting a posture it no longer has.

**Phase 1 is the substrate only.** The authenticated upload path, reference counting / orphan sweep, and the theme-asset migration this ADR's Context motivates are all still open.

### The registry split is not closed yet

The migration of `proton`/`postmod` to api-canonical `/css` fixtures — the first force in the Context above — did **not** land with the store, for two independent reasons found during implementation:

1. **`sanitizeStylesheetSource` corrupts escaped identifiers.** `stripOnce` emits `decodeCssEscapes(css)`, decoding the whole sheet rather than decoding only to detect danger, so `.hover\:text-white` (a class named `hover:text-white`) is rewritten to `.hover:text-white`. `proton` carries 54 such escapes, all Tailwind utility overrides. The module header calls this "the rare escape-dependent identifier … an accepted trade"; against a Tailwind ui it is the common case, and it silently mangles real author stylesheets today, independent of this ADR. Tracked separately; the theme migration is blocked on it.
2. **`postmod` bundles commercial fonts** (Akzidenz-Grotesk, Avant Garde, Officina, Corpid). Moving them from a private ui bundle to a public API route is a redistribution question, not a technical one, and is unresolved.

So the split stays temporary-by-design as this ADR predicted, with a named blocker rather than an open question.

## Amendment (2026-07-21) — Phase 2 landed (#342)

The deferred upload path, `visibility`, and lifecycle sweep ship in #342 — but the shape below diverged from the Phase-1 sketch after a design grilling, and the divergences are the point of this amendment.

- **Scope narrowed to theme imagery.** Avatars were pulled out to their own issue (#396). They had ridden along as a #361 fix, which made this a part-infra, part-security change reviewed under one lens; worse, the avatar work made an `img-src 'self'` CSP _reachable_ without actually closing #361 (no CSP tightening, no migration of existing hotlinked avatars). Half a fix in the wrong issue. So Phase 2's only consumer is the author uploading a background image for a stylesheet.

- **No `visibility` column — delivery is derived from `ownerId`.** The Phase-1 note anticipated an explicit visibility column. With avatars gone, `ownerId` null ↔ public (site fixture) and `ownerId` set ↔ member-only is a _total, exceptionless_ mapping, so a separate column would only let the two drift and would make illegal states (`public + owned`, `members + unowned`) representable. The serve route reads `ownerId`: null serves unauthenticated with a `public` immutable cache; set requires auth and caches `private` so a shared cache cannot hand a member's bytes to an anonymous fetch. An owner-private tier is deferred with avatars — nothing produces one yet. When Phase 3 brings a case where policy ≠ provenance, the column is an additive migration then.

- **Quota is a count (`UserRank.assetLimit`), not a byte budget.** The issue named the `authorStylesheetLimit` mould, which is a count; the per-asset 2 MB cap already bounds total bytes, so a count is the idiom-matching, staff-legible unit ("20 images", not "10485760 bytes"). Its semantic is deliberately the **opposite** of `authorStylesheetLimit`'s: `0` = none, `null` = unlimited, `N` = cap. That inversion is forced, not chosen — a brand-new User must be able to hold _no_ upload allowance, which `0 = unlimited` cannot express. The allowance scales up the rank ladder like `personalCollageLimit` (User `0`, Member `1`, … Stellarige `6`) with staff/SysOp uncapped (`null`). A brand-new member has no reason to upload a stylesheet asset, so they cannot; the gate lives in the quota, not a separate permission.

- **Upload is image-only; fonts stay seeder-only.** `POST /api/asset` takes a raw body (not multipart — the payload is one binary identified by magic bytes, so a filename and a parser dependency buy nothing) and stores it through `uploadAsset`, which enforces `image/*` on top of `validateAsset`. This is load-bearing, not cosmetic: `cssValidate` permits `url(/api/asset/<hash>)` inside `@font-face`, so a member who could store font bytes under any kind would resurrect the #343 redistribution liability as _unbounded, user-generated_ content. Image-only keeps fonts to what staff deliberately ship.

- **Orphan sweep, not reference counting.** A daily job (`assetSweepJob`) scans `AuthorStylesheet.source` for `/api/asset/<hash>` and deletes member-owned assets that are unreferenced and past a 24h grace window; site-owned assets are never swept. References live inside freeform CSS text, so extracting them means parsing that text regardless — a reference table would just cache that extraction behind a write path, which is where drift enters and whose failure mode is deleting a _live_ asset. The grace window covers the gap between an upload and the sheet that will reference it.

**Still open after Phase 2:** the `proton`/`postmod` theme migration (#341, #343) and avatars + the #361 CSP work (#396).

## Follow-up

Phase 1 shipped under #290; Phase 2 (upload, ownerId-derived delivery, sweep, count quota) under #342. The theme migration (#341/#343) and avatars/#361 (#396) remain tracked separately.
