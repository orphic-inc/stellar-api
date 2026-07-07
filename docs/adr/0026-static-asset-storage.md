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

## Follow-up

Implementation is tracked separately (#290); this ADR is the design gate, not the build.
