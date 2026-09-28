# Remote images are imported on write, so no viewer's browser fetches a third-party host

**Status: Accepted (2026-09-28).** Decided in the grill of [#457](https://github.com/orphic-inc/stellar-api/issues/457); the outcome is on that issue. Built in [#737](https://github.com/orphic-inc/stellar-api/issues/737), with the backfill in [#738](https://github.com/orphic-inc/stellar-api/issues/738) and the CSP in [stellar-ui#402](https://github.com/orphic-inc/stellar-ui/issues/402). Extends [ADR-0031](0031-injected-css-threat-model.md) §1 (the defended population is the non-consenting viewer) from CSS to images, and amends its §6 and Rejected sections. Builds on [ADR-0026](0026-static-asset-storage.md), the asset store.

## Context

A remote image discloses the viewer's IP address, user agent and visit timing to whichever host serves it. Five surfaces put a remote image in front of a viewer who did not choose it:

- BBCode `[img]` in posts, comments and the other prose the api renders;
- avatars;
- donor `customIcon` and `secondAvatar`;
- community, featured-album, request and release images;
- release covers.

The CSP could close all of them with `img-src 'self'`, and ADR-0031 §6 declined to, because images had to stay remote for these features to work. An image proxy was the obvious way out, and #301 had ruled it out as "disproportionate attack and ops surface". That ruling rested on a premise ADR-0031 already flagged as wrong: that the shipped CSP scoped images.

The legacy implementation did proxy images, but only for viewers holding a permission ("image proxy & anti-canary"), in practice staff. Everyone else fetched remote images directly. The threat was real enough to build for, and the protection went only to privileged viewers.

## Decision

### 1. The endgame is `img-src 'self' data:`

No viewer's browser fetches a third-party image. The protection is for every viewer, not for a permission, because a `[img]` in a thread is the textbook non-consenting case ADR-0031 §1 defends. `data:` stays: the form controls draw their chevrons and ticks as `data:` SVGs, which make no request.

### 2. The server imports a remote image once, when it is written

It is neither store-only nor a proxy on read.

- **Store-only** would refuse remote URLs and make every image an upload. That drops "paste a link", which the legacy implementation and every member expect.
- **A proxy on read** fetches member-chosen URLs every time someone views them, indefinitely. That is a permanent SSRF, bandwidth and cache surface, and a dead host breaks old posts.

Instead, a write records each remote image URL, and a background job fetches it **once**. The job validates the bytes and stores them content-addressed as an asset of kind `Imported`. Rendering resolves the URL to `/api/asset/<hash>`.

- **The member's text is never rewritten.** The post keeps the URL they wrote, and resolution happens at read time: BBCode through `ResolveMaps`, and field surfaces in their serializers.
- **An image not yet imported, or that failed, is never drawn remotely.** BBCode renders it as its link, marked "(image)". A field surface falls back to its default, such as the default avatar.
- **One row per URL, site-wide** (`RemoteImage`). A popular image is fetched once however many posts use it. The remote host sees one request, from the server, when the image is first written.
- **Asynchronous.** A save never waits on a slow host. The job runs a few imports at a time, leases each row so overlapping cycles never duplicate work, retries a timeout or a 5xx with backoff, and records a final failure with its reason.
- **What renders as an image, and what gets imported, is one predicate** (`lib/bbcode/images.ts`), so the two cannot drift.

### 3. The fetch pins the address the guard vetted

The fetch reuses `lib/ssrfGuard`, with every redirect hop re-vetted. The guard documents a gap it leaves open for the link checker: DNS rebinding, where the name resolves once for the check and again for the dial. For a HEAD probe whose body is discarded, winning that race yields one bit. This fetch **keeps and stores the body**, so here the race is closed. `lib/remoteFetch.ts` passes node's http client a `lookup` that returns the vetted addresses, so the socket never resolves the name itself. TLS still verifies the certificate against the hostname. No new dependency is needed.

The rest bounds what a hostile or broken host can cost:

- **a streaming hard cap** at `STELLAR_ASSET_MAX_BYTES`, abandoned mid-body, plus a check on a declared `Content-Length`;
- **one timeout** for the whole exchange, redirects included;
- **magic bytes decide** (`assetValidate`), and the remote `Content-Type` is ignored. Only images are accepted, so a hijacked fetch of an internal JSON endpoint stores nothing;
- **a fixed `User-Agent`** naming the site, and no cookie, `Referer` or credential.

### 4. An import is owned by its first requester, and does not count as an upload

- `Imported` assets are owned by the member who first referenced the URL, so delivery is member-gated under ADR-0026's `ownerId` rule, and abuse traces to someone. Every surface that shows these images is behind a session.
- **The rank `assetLimit` does not count them.** That limit governs uploads, and at its default of `0` counting imports would stop most members posting an image.
- **They answer to their own ceiling:** a member may introduce `STELLAR_IMAGE_IMPORT_DAILY_LIMIT` new URLs per rolling 24 hours. A write that would pass it is refused with `429`, before anything is recorded. Reusing a URL already known costs nothing. Each import is bounded by the asset size cap, so the ceiling bounds what one member can make the server fetch and store in a day.

### 5. The sweep keeps an import while its URL is referenced

The member's text holds the remote URL, not an asset path, so the asset sweep also walks every image-bearing column for remote URLs (`collectReferencedRemoteUrls`). It keeps any asset a still-referenced URL points at. When an import is collected, its row goes with it (Cascade), and a later reference imports the image again. The backfill (#738) walks the same columns, so the list of image-bearing columns exists once.

### 6. Existing images are backfilled before the CSP tightens

A one-time, idempotent backfill (#738) registers every remote image URL already stored. It is owned by the earliest author and exempt from the ceiling, and it reports imported and failed counts, with reasons. **The CSP change ships only after a clean report**, because tightening first would break every image not yet imported. Grandfathering existing references was rejected: `img-src 'self'` cannot coexist with remote images, so the CSP could never tighten.

## Consequences

- stellar-ui can set `img-src 'self' data:`. Together with ADR-0031 §6's `font-src` and `connect-src`, that is one CSP change (stellar-ui#402).
- `renderExternalImages`, #301's proposed viewer toggle, is **retired**. With no remote fetches, it would protect nothing. ADR-0031 §2's control to disable member themes is a **different** concern, visual evasion rather than disclosure, and stays stellar-ui#194.
- A new image appears a job interval after it is saved (`IMAGE_IMPORT_INTERVAL_MS`, 30 s by default), and until then renders as its link.
- The server now makes outbound requests on members' behalf. Its egress is the api's, so an operator who restricts egress has to allow it for images to import.
- A failed import stays failed. The member can upload the image instead, and the reason is on the row.
- Adding a surface that renders a remote image means adding its column to `collectReferencedRemoteUrls`, and calling `registerRemoteImages` on its write path.
