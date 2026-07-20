# The authored-stylesheet member lifecycle

**Status: Accepted (2026-07-19).** Decides [#353](https://github.com/orphic-inc/stellar-api/issues/353) on the [authored-stylesheet wayfinder map](https://github.com/orphic-inc/stellar-api/issues/347). Rides on the delivery contract of [ADR-0024](0024-stylesheet-delivery-contract.md) (Accepted, and unchanged by this ADR) and the threat model of [ADR-0031](0031-injected-css-threat-model.md). Implements the member-facing half of [PRD-03](../prd/03-stylesheet-themes-and-scoring.md).

## Context

ADR-0024 settled how an authored stylesheet is stored and delivered, and ADR-0031 settled what defends the viewer from its contents. Neither says what a member can _do_ with one. That gap was not academic: stellar-ui [#108](https://github.com/orphic-inc/stellar-ui/issues/108) — the author/adopt UX — is unbuilt, so the entire member-facing half of the subsystem does not exist. A member cannot author a sheet, find one, or adopt one through any interface. What exists is an API surface, a delivery route, a CRS dimension that rewards adoption, and ten themes seeded by the System user. The system rewards a behaviour it provides no way to perform.

Charting the intended flow against the shipped surface found three gaps and two claims that were already false.

The surface is `POST /author`, `GET /author/:userId`, `GET /author-stylesheet/:id`, `GET /author-stylesheet/:id/css`, and `POST /author-stylesheet/:id/adopt`. There is **no update route and no delete route**, and no `updateAuthorStylesheet` or `deleteAuthorStylesheet` exists anywhere in `src/`. Two shipped pieces of code assert otherwise: `routes/api/stylesheet.ts:115` justifies `Cache-Control: no-cache` with "Sheets are mutable (authors edit in place)", and `getAuthorStylesheetById`'s docstring calls itself "the edit-path read". Both describe a path that was never built. [#350](https://github.com/orphic-inc/stellar-api/issues/350) then decided that "adoption tracks the author's edits", which is a statement about the same absent path.

The quota compounds it. [#146](https://github.com/orphic-inc/stellar-api/issues/146) is closed and the rank gate is live — `createAuthorStylesheet` counts and refuses — so the registry-space limit is enforced with no way to free a space. It is a one-way ratchet. Worse, the limit a member is _shown_ is not the limit enforced: `auth.ts:93` reports `Math.max(primary, ...secondaryRanks)` while `createAuthorStylesheet` consults the primary rank only. PRD-03's "$tylesheets — donor-added slots" is precisely the secondary-rank case, so the promised donor feature reads as granted and enforces as absent. The same expression inverts `0 = unlimited`: a primary rank of `0` (unlimited) plus a secondary of `5` displays `5`. `personalCollageLimit`, on the line above and the precedent `createAuthorStylesheet` was written to mirror, has the identical bug.

## Decision

### 1. The registry is a personal locker, not a published gallery

Authoring a stylesheet does not publish it to a browsable, site-wide index. Sheets are personal artifacts shared by direct reference — the author hands someone an id or a link, through a forum thread, IRC, or a PM. No browse endpoint ships; `GET /author/:userId` remains the only listing, and it requires already knowing whose sheets you want. ADR-0024's "adoption by direct reference until then" stops being an interim state and becomes the decision.

The distribution channel is the community itself. This is why PRD-03's scoring survives the choice: the tiering table pays out to roughly sixteen distinct adopters, which peer-to-peer sharing in a `/private/` community reaches. A gallery is not missing from the design; the forum is the gallery.

Consequence: **`AuthorStylesheet.name` is a private label and takes no DB uniqueness.** Names are never user-visible identifiers to anyone but the author, so the existing application-level `findFirst({ authorId, name })` that fixture idempotency relies on is sufficient, and the open question about a per-author or global uniqueness axis is answered by not needing one.

Second consequence, and the reason this reading is also the cheapest against ADR-0031: a locker keeps the drive-by population at zero by default. A gallery would make every authored sheet render at members who never adopted it — exactly ADR-0031 §1's non-consenting viewer — turning the browse surface itself into a new place hostile CSS executes.

### 2. Edit and delete close the lifecycle

`PUT /api/stylesheet/author-stylesheet/:id` accepts `{ name, source }` and is author-scoped. This retires both false claims above: `no-cache` becomes justified, and `getAuthorStylesheetById` becomes the edit-path read it already called itself. #350's "adoption tracks the author's edits" becomes true rather than aspirational — an edit propagates live to every adopter, which is the behaviour that decision assumed and the reason sheet identity must stay a stable sequential id while content varies.

### 3. Delete is soft; adopters keep rendering

`AuthorStylesheet` gains `deletedAt`. Soft-deleting frees the author's registry space immediately and removes the sheet from adoption, while it **keeps serving `/css` to members who already adopted it**. Nobody's site changes under them.

This is the only option where quota reclamation and adopter stability are not traded against each other. Hard delete would null every adopter's pointer and drop them silently to the Sublime default, letting an author unilaterally restyle strangers' sites with no explanation. Refusing to delete while adopted would hold the author hostage and rebuild the ratchet the delete exists to break. Soft delete is also the house idiom — users soft-delete via `disabled`, forum topics and posts via `deletedAt`.

The `CRS_STYLESHEET_ADOPTION` ledger is **not** touched. Those adoptions were earned, and PRD-03's marginal tier table already eases an author's score down as live adoption counts fall rather than re-rating history; deleting a sheet should not retroactively rewrite CRS.

Accepted, and named rather than solved: **a member cannot fully retract a sheet they regret.** A theme that is embarrassing or hostile keeps serving to whoever already adopted it. Retention and reaping of soft-deleted rows is deliberately **out of scope** — it is an operations question that sharpens once there is traffic to calibrate a dormancy window against, and choosing a threshold now would be choosing a number with nothing behind it. When it is taken up, the precedent to follow is `linkHealthJob`'s 24h cycle and `notifyContributorsOfDeadLinks`' batched System PM (`senderId: null`), and the trap to avoid is that a reaper keyed on age alone silently reinstates the hard-delete this section rejected. Note for whoever picks it up: there is no existing job that removes failing contributions — `sweepStaleWarnLinks` promotes `WARN → FAIL`, notifies, and deletes nothing.

### 4. Enforcement rises to meet the advertised quota

`createAuthorStylesheet` consults the **maximum across the member's primary and secondary ranks**, matching what `auth.ts` already reports. This ships PRD-03's donor-added slots, since secondary ranks are how donor grants are modeled. The alternative — dropping the display to primary-only — would retire a written product commitment through a bug fix instead of a decision.

`0` anywhere in the rank set means **unlimited**, correcting the `Math.max` inversion in which an unlimited primary rank could be capped by a donor perk. `personalCollageLimit` receives the identical correction in the same change: the two limits are written to mirror each other, and leaving a known-identical bug on the adjacent line would make that comment a lie and ensure it is never fixed.

No new read surface is required. The limit rides the auth payload and is in the OpenAPI schema; the used-count is the `total` on `GET /author/:userId`'s paginated envelope. A UI can render "3 of 5 registry spaces" today. The quota was never invisible — it was wrong, and a member could be shown `5`, allowed `3`, and refused with a message quoting a number they had never been told.

### 5. Authoring is paste and edit-in-place; upload is UI sugar

Sheets are authored by pasting or editing CSS text against the existing JSON contract. A file picker is a legitimate UI affordance, implemented client-side with `FileReader` writing into the same field — **not** a multipart upload route. Under ADR-0031 a `.css` upload endpoint would be a second path by which member bytes enter the system, and §4's "System image capability is an asset-store authorization property" rests on ingress being tightly held. Adding an ingress shape to save the UI a `FileReader` call is a bad trade.

`source` stays capped at 100,000 characters. The cap is generous for a hand-written theme and tight for a compiled framework dump, which is the intended boundary: PRD-03 decided the user contract is `.css` only and rejects SCSS, and the cap says _author a theme, do not paste a build artifact_.

### 6. Rejection names the rule, the construct, and the location — all of them

Under ADR-0031 §5 the validator rejects rather than cleans. Rejection messages are **specific and exhaustive**: name the offending rule, the construct that tripped it, and where it appears, and report every violation in one pass rather than failing at the first.

The instinct to keep these messages vague, so a hostile author cannot iterate toward a bypass, is wrong here. [#351](https://github.com/orphic-inc/stellar-api/issues/351) established that under a rejecter the live risk is **false positives blocking honest saves**, and a vague message is exactly what makes a false positive unactionable — the author faces 100KB of input and has no move but deleting things at random. The vagueness also buys little: nothing rate-limits repeated `POST /author`, so an attacker bisects to the rule in a few dozen attempts. First-fail reporting is rejected on the same grounds, since it turns a sheet with four bad `url()`s into four round trips.

Route rejections use **`{ errors: { source: [...] } }`**, not the `{ msg }` envelope the module's `AppError` path currently produces. This is the field-level shape a form wants, it carries a list naturally, and it puts the message beside the field it concerns. The validator therefore returns a **structured result** and each call site renders it: the route into that envelope, the fixture seeder into a thrown boot failure carrying the same rule and location detail as a log line. Implementation folds into [#360](https://github.com/orphic-inc/stellar-api/issues/360), where the rejecter lands.

### 7. Recovery from a self-inflicted theme is a precondition, not a follow-up

A member can adopt a sheet whose CSS hides the control needed to un-adopt it. Under §1 this is predominantly a **bug**, not an attack: members hand-write CSS, over-broad selectors are how hand-written CSS fails, and a locker has no gallery, no review queue, and no moderation checkpoint between authoring and a friend adopting.

**No API work is required.** `PUT /api/profile/me` already flips the Personal/Registry radio and nulls the pointer, and CSS leaves by no path but `/css`. The gap is entirely a stellar-ui affordance, and it belongs to the viewer-side disable control already scoped in [ui #194](https://github.com/orphic-inc/stellar-ui/issues/194) rather than to a second switch — that issue correctly argues these reduce to one viewer preference.

What changes is its timing. ui #194 was scoped as a precondition on the deferred Profile and Community slots, on the reasoning that "only adopters run a sheet" today. Voluntary adoption is not the same as reversible adoption, so **ui #194 is now also a blocker on [ui #108](https://github.com/orphic-inc/stellar-ui/issues/108)**, recorded as a native dependency. The authoring UI cannot land before the recovery path exists. ui #194 stops being deferrable, which is correct: it was deferrable only while nothing member-facing depended on it.

## Consequences

- The API contract is **not** complete, and the gaps are exactly edit, delete, and the quota semantics. Read, delivery, adopt, switch-back, and quota display all already exist — the member-facing flow needs less new surface than the unbuilt state of ui #108 suggests.
- `AuthorStylesheet` takes a schema migration for `deletedAt`, and every read path — the list, the by-id read, `/css`, and adoption — must decide whether it filters. Adoption and listing filter; `/css` deliberately does not, which is what §3 buys.
- The name-uniqueness question on the wayfinder map is closed by §1 rather than answered on its own terms.
- ui #108 gains concrete scope (author, edit, delete, quota display, direct-reference adopt) and a blocker it did not have.
- PRD-03 needs amending: it describes the rank-gated count limit as deferred to #146, which is closed and enforced.

## Rejected

- **A published gallery with a browse endpoint.** It is where the subsystem's own scoring model points — the tiering curve's upper bands and #258's contest-winner promotion both read naturally as gallery features. Rejected because it manufactures the drive-by population ADR-0031 §1 defines as the defended one, making every authored sheet render at members who never chose it, and because peer-to-peer sharing in a `/private/` community already reaches the adoption counts the curve is calibrated for. Revisit only alongside a moderation checkpoint.
- **Hard delete with adopter fallback**, and **refusing deletion while adopted** — see §3.
- **Dropping the reported quota to the primary rank.** Honest immediately, but it would retire PRD-03's donor slots silently. See §4.
- **A multipart `.css` upload route** — see §5.
- **Vague rejection messages, and first-violation-only reporting** — see §6.
- **A dedicated adopter-recovery toggle separate from ui #194's control.** Rejected as the third switch answering one question from the viewer's seat.
