# Injected-CSS threat model and the store-time boundary

**Status: Accepted (2026-07-19). Implemented by [#360](https://github.com/orphic-inc/stellar-api/issues/360) — §3, §4 and §5 are live in `src/lib/cssValidate.ts`; §6's CSP tightening is stellar-ui's half and tracked separately.** Supersedes [ADR-0003](0003-stylesheet-injection-isolation.md), which is retained as history. Decides [#349](https://github.com/orphic-inc/stellar-api/issues/349) on the [authored-stylesheet wayfinder map](https://github.com/orphic-inc/stellar-api/issues/347). Rides on the delivery contract of [ADR-0024](0024-stylesheet-delivery-contract.md) (Accepted) and the asset store of [ADR-0026](0026-static-asset-storage.md); binds [#342](https://github.com/orphic-inc/stellar-api/issues/342) normatively (§4).

## Context

ADR-0003 decided a two-arm, defense-in-depth boundary for user-authored CSS: Arm 1 a protected-chrome cascade lock, Arm 2 a store-time sanitizer paired with an inject-time CSP that locked `img-src` / `font-src` / `connect-src` so a `url()` the sanitizer missed still could not reach an arbitrary host.

The 2026-06-23 amendment dropped Arm 1, which is well understood and correct — CSS cannot lock the cascade against `!important` (for important declarations the layer order reverses), so no arrangement of layers or resets can defend chrome against a sheet we agree to inject. That part is settled and is not reopened here.

What was not understood is that the **same amendment also hollowed out Arm 2's second half**. To preserve theming freedom it reversed the CSP's resource axes, and stellar-ui shipped that: `img-src 'self' data: https: http:`, `font-src 'self' data: https:`, `connect-src 'self' https:`. The production CSP is strict on execution (`script-src 'self'`, `object-src 'none'`, `base-uri`/`form-action 'self'`) and open on resources. For **exfiltration** it constrains nothing.

So the store-time sanitizer is not one of two arms. It is the sole control standing between an authored sheet and a request to an arbitrary host — and five separate places in the two repos asserted otherwise: stellar-api's ADR-0003, `lib/cssSanitize.ts` and `schemas/stylesheet.ts`, and stellar-ui's ADR-0003 ("the CSP — not the injector — is the real XSS/exfiltration backstop") and `StylesheetInjector.tsx` ("the app-wide CSP blocks script execution + exfiltration"). A boundary that its own governing documents describe inaccurately is not a boundary anyone can reason about, which is the condition this ADR exists to end.

## Decision

### 1. The defended population is the non-consenting viewer, not the consenting adopter

Today `StylesheetInjector` reads the viewer's own settings, so an authored sheet executes only in the browser of a member who adopted or wrote it. That is not the end state: PRD-03's Slots & cascade decision (2026-06-13) specifies page-context-first precedence, where "a Profile or Community page shows its own slot to every viewer, regardless of the viewer's Site Stylesheet". When the deferred Profile and Community slots ship, viewing a member's page executes that member's CSS in the visitor's browser with no adoption and no consent.

The threat model is written for that endgame. A model scoped to voluntary adoption would expire the moment the Profile slot lands, and the re-decision would then happen under delivery pressure, which is when a threat model is hardest to argue honestly.

The attacker is a member in good standing on an invite-only instance. The victim is any other member who visits a page the attacker controls the styling of.

### 2. What is defended, and what is accepted

**Defended (the sheet must not be able to do this):**

- Disclose a viewer's IP address, user agent, or visit timing to a third-party host.
- Correlate who viewed what and when, by causing any fetch to a host the author can observe.
- Smuggle arbitrary content — imagery in particular — into a page rendered to other members, bypassing whatever moderation an upload path imposes.
- Use `@font-face` or image fetches as a side channel to the same ends.

**Accepted, deliberately and by name:**

- **Same-origin fetches to the asset route.** A permitted `url(/api/asset/<hash>)` fires a same-origin GET carrying the viewer's cookie. CSS cannot read the response, and no endpoint reflects such a request back to the author in a readable form, so there is no known readback path. Accepted.
- **Avatar hotlinking.** `profileSettingsSchema.avatar` is `z.string().url()` — an arbitrary remote URL, not even https-constrained the way `externalStylesheet` was tightened by ADR-0024 §3. Every viewer of a member's page therefore already leaks IP and timing to a host that member chose, with no CSS involved. This ADR does not fix it and does not pretend to: closing the CSS door while this stands would be a boundary that defends one entrance. Tracked separately.
- **Visual and moderation evasion on drive-by pages.** ADR-0003's amendment justified maximal theming freedom partly on the grounds that "hiding your own nav is a cosmetic choice, not a security boundary". That reasoning held for voluntary adoption and does not survive §1: on a drive-by Profile page an author can suppress the moderation affordance pointed at them, for every visitor. There is no CSS-level answer — Arm 1 is dead for the reason the amendment gave, and this ADR does not revive it. The mitigation is non-CSS and lives outside the themed document: a viewer-side control to disable member themes, plus a report route reachable without the themed page. Specified here as a constraint on the deferred slots; implemented in stellar-ui.

### 3. The `url()` allowlist: content-addressed assets and relative paths only

A `url()` target is permitted only if it is a same-origin relative path. In practice that means the asset route's content-addressed form, `/api/asset/<sha256>` (ADR-0026, `assetUrl`), plus ordinary relative references. Every explicit scheme and every protocol-relative `//host` reference is a violation.

**`data:` URIs are no longer permitted**, for any author including the reserved System user. `data:` was the content-smuggling vector named in §2, and under §1 a smuggled payload is displayed to non-consenting visitors. It has no remaining justification: the shipped catalog does not use it (all ten built-in themes are token-only `:root { --st-* }` blocks per stellar-ui ADR-0005, and several carry an explicit data-scrub note), and asset-bearing themes have a sanctioned home in the asset store.

This costs the real catalog nothing measurable — there is not one live `url()` across the ten shipped themes today.

### 4. System image capability is an asset-store authorization property, not a sanitizer tier

Official themes may embed imagery; member-authored sheets may not. That distinction is **not** implemented by teaching the sanitizer who owns a row.

It falls out of write authorization. The asset store has no upload route: `putAsset` is reachable only from the seeder, so today the System user is the only writer, and `/api/asset/<hash>` can only resolve to bytes that were reviewed in the repository. A member cannot reference an image because a member cannot put one there — the allowlist stays uniform and ownerless.

Keeping the sanitizer a pure function of one string is deliberate. A trust-tiered sanitizer would mean two policies to audit inside a pass that has already shipped one bypass ([#152](https://github.com/orphic-inc/stellar-api/issues/152)) — the same "second shape to audit" argument ADR-0024 §1 used to reject `<style>` injection as a second delivery path.

**Normative precondition on [#342](https://github.com/orphic-inc/stellar-api/issues/342).** Member-facing asset upload must not ship until member-uploaded bytes cannot be referenced from a sheet rendered to a non-consenting viewer without moderation. §3's guarantee rests entirely on the write-side restriction described above; an upload path that ignores this silently undoes it without a line of this ADR changing. #342 may argue for a different arrangement, but it must argue for it explicitly rather than inherit the gap.

### 5. The instrument rejects; stored bytes are never rewritten

`sanitizeStylesheetSource` cleans — it strips and neutralizes, and returns a modified copy, so an honest author's save is never blocked. That is replaced: **the boundary validates and rejects, and the stored source is byte-identical to what the author submitted.**

The decisive argument is that detection and storage were conflated. The pass decodes CSS escape sequences because a raw-text regex would otherwise miss `\40 import` (the #152 bypass), but `stripOnce` decodes the _entire sheet_ and returns the decoded text, so a transformation that exists purely to make matching honest is **persisted**. That is the root of the corruption bug ([#340](https://github.com/orphic-inc/stellar-api/issues/340)), and it is a class, not an instance: any cleaning sanitizer that must normalize in order to detect will rewrite bytes it had no mandate to touch.

A detector that only answers yes or no may normalize as aggressively as correctness demands, at zero corruption risk, because it never writes. Rejecting therefore retires the entire class rather than fixing one symptom, and it replaces a silently mangled stylesheet — images vanishing with nothing explaining why — with an actionable error naming the offending construct.

The accepted cost is that a false positive blocks an honest save outright, which is a harder failure than a stripped reference. It is accepted because §3 made the rule short and mechanical: one path shape, no schemes, no `data:`.

**Both call sites fail fast.** The HTTP authoring route rejects with a field error. `seedStylesheetFixtures` also asserts rather than launders: a shipped theme that violates the boundary fails at boot instead of being quietly cleaned into compliance. The fixtures are the earliest available signal of what an authored sheet will hit, and a canary that cannot fail is not a canary.

### 6. CSP posture: tighten where it is free, and say plainly where it is not

- **`font-src` tightens to `'self'`.** `@font-face src` is a genuine exfiltration axis and, after §3, no legitimate theme needs anything else. This restores real defense-in-depth on one axis at no cost.
- **`connect-src` tightens to `'self'` plus the Sentry ingest host.** CSS cannot issue XHR, so this defends nothing in this threat model; it is adjacent hygiene taken while the file is open.
- **`img-src` stays open.** Tightening it to `'self'` would break every remote avatar (§2). This is the honest statement of the boundary: the CSP constrains fonts, and deliberately does not constrain images, because a non-CSS feature requires the allowance.

The CSP is therefore a partial backstop, precisely scoped, and must be described that way everywhere. It is not "the real exfiltration backstop", and no document in either repository may say so again.

## Consequences

- The record is corrected in five places: this ADR supersedes stellar-api's ADR-0003 (which gains a forward pointer), and the false CSP claims in `lib/cssSanitize.ts`, `schemas/stylesheet.ts`, stellar-ui's ADR-0003, and `StylesheetInjector.tsx` are struck. Until the boundary is implemented, those comments describe today's reality — the sanitizer is alone — and cite this ADR as the decided target, so no commit leaves a comment false in a new direction.
- Implementation is a separate change from this decision: the allowlist narrowing, the clean-to-reject conversion, and the fail-fast seed assertion are filed as their own issue. This ADR is the specification they are built against.
- [#354](https://github.com/orphic-inc/stellar-api/issues/354) inherits a constraint rather than a new ticket: restoring the imagery that `anorex` and other asset-bearing themes depend on must go through `putAsset` and be referenced as `/api/asset/<hash>`. §3 removed `data:` as an option. Whether asset-bearing themes become api-canonical remains #354's call.
- [#351](https://github.com/orphic-inc/stellar-api/issues/351) gains something concrete to assert: §5 makes the seeded fixtures a boundary assertion at boot, which is the canary behaviour that ticket is chartered to specify.
- The deferred Profile and Community slots inherit §2's non-CSS mitigation as a precondition. They cannot ship without the viewer-side escape hatch, because they are what converts theming freedom into a moderation-evasion surface.
- `data:` removal is a real capability reduction for any member who had embedded an image. The instance is pre-alpha and the shipped catalog does not use `data:`, so the practical migration cost is nil.

## Rejected

- **Rebuilding Arm 1 (protected chrome).** Superseded for the reason ADR-0003's amendment gave and verified in a real browser: `!important` defeats every layer arrangement. §1 raises the stakes of visual override but does not change the fact that CSS cannot defend against it. The answer is outside the document, not inside the cascade.
- **A trust-tiered sanitizer** granting System-owned rows a wider allowlist — §4. Two policies to audit, inside the one control that has already been bypassed once.
- **An https CDN allowlist for `url()`.** Reintroduces exactly the third-party fetch this boundary exists to prevent, in exchange for convenience the asset store already provides.
- **Tightening `img-src` now.** Correct in isolation, but it breaks avatars, and the avatar hole is a wider problem than CSS. Deferred to its own decision rather than half-solved here.
- **An image proxy for external references.** Already NO-GO (2026-07-04, #301) as disproportionate attack and ops surface. Recorded here because that rejection reasoned from "a CSP-scopeable SPA" while the shipped CSP does not scope images — the premise deserves re-examination when the avatar hole is decided, and #301's own escape hatch (a `renderExternalImages` toggle) is the same control §2 requires for member themes.
- **Keeping the cleaning sanitizer and fixing #340 alone.** Fixes the instance, keeps the class: a cleaner that normalizes to detect will always rewrite bytes it was not asked to change.
