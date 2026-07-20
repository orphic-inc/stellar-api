# PRD-03 — Stylesheet Themes & Scoring

**Status:** Draft · **Owner:** @obrien-k
**Extends:** [PRD-01 Community-Score / CRS](01-Community-Score.md) · **Decisions:** [ADR-0002 community-health-pulse → CRS](../adr/0002-community-health-pulse.md) (accrual model), [ADR-0003 stylesheet injection isolation](../adr/0003-stylesheet-injection-isolation.md)
**Numbering:** PRD-01 Community-Score · PRD-02 IRC & Announce · **PRD-03 Stylesheets** · PRD-04 Contribution/Release/Music · PRD-05 Rules & Governance · PRD-06 Ratio · PRD-07 Donations · [PRD-08 Collages & Cover Art](08-collages-and-cover-art.md)

> Lean PRD. Captures the decided shape + the Community-Score weights, flags TBDs, and maps each concept to existing code so this becomes a red-green descent, not greenfield. Stylesheet scoring is a **dimension of PRD-01's CRS**, not a separate score.

## Problem

Stellar is an invite-only `/private/` community site. Users want to theme their own profile and the site (the universal theme), publish their own stylesheet for others, and be rewarded for organic customization/sharing — without opening an injection vector.

## Stylesheet types

| Type                            | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Built-in / site stylesheets** | Seeded themes: `kuro`, `layer-cake`, `postmod`, `proton`, `sublime`. **Sublime = default/base + selectable + contest reference** (net-new authoring; reset target).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **ExternalStylesheet**          | An `https:` URL on the user's profile (`profile.externalStylesheet`) — the **Personal** source. Serves CSS the browser consumes directly; never fetched, compiled, or transformed by us (ADR-0024).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **AuthorStylesheet**            | A user-authored **`.css`** saved for others to adopt — the **Registry** source. **Many per author** (cardinality decided 2026-06-13; rank-gated _count limit_ = **registry spaces**, shipped and enforced — #146 closed, semantics corrected by [ADR-0032](../adr/0032-authored-stylesheet-member-lifecycle.md) §4). The registry is a **personal locker, not a browsable gallery**: sheets are shared by direct reference (forum, IRC, PM) and no browse endpoint ships (ADR-0032 §1). Stored as sanitized `source`, delivered as `text/css` via the API `/css` route (ADR-0024). The author is a **StylesheetAuthor** — shorthand for any member who has authored one, not a distinct role. (`AuthorStylesheetUrl` as a distinct URL-typed entry is **dropped** — Personal covers the URL case.) |
| **CommunityStylesheet**         | Community-scoped theme, set by that Community's Staff; rendered to any viewer on that community's pages. Slot deferred (TBD — tied to Contests / Community Toolbox).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Injection boundary**          | Store-time `cssValidate` (API) — the guard on user sheets, specified by [ADR-0031](../adr/0031-injected-css-threat-model.md), which supersedes ADR-0003. It **validates and rejects**, storing bytes verbatim; `url()` narrows to same-origin relative paths (`/api/asset/<sha256>`) with `data:` refused for every author. The UI CSP is a **partial** backstop, not the boundary's other half: it is strict on execution and open on `img-src` for avatars. Arm 1's chrome lock was **dropped** in the 2026-06-23 amendment: CSS cannot lock the cascade against `!important`, so themes may restyle chrome freely.                                                                                                                                                                              |

### Slots & cascade (decided 2026-06-13)

A stylesheet renders by being placed into one of three single-valued **slots**, selected by **page context** — not a single global "active theme":

| Slot                     | Set by                 | Rendered when                                |
| ------------------------ | ---------------------- | -------------------------------------------- |
| **Profile Stylesheet**   | the profile's owner    | any viewer is on _that owner's_ profile page |
| **Site Stylesheet**      | the viewer             | the viewer is on the general site            |
| **Community Stylesheet** | that Community's Staff | any viewer is on _that_ community's pages    |

**Precedence is page-context-first:** a Profile or Community page shows its own slot to _every_ viewer, regardless of the viewer's Site Stylesheet. On the general site the viewer sees their own Site Stylesheet, falling back to the **Site Theme** (`Sublime`/Default) when they have not adopted one. A member has exactly one stylesheet per slot.

**Only the Site Stylesheet slot scores** (a **Stylesheet Adoption**): the viewer adopting another member's AuthorStylesheet credits the author. Slotting your own sheet as your Profile Stylesheet is not an adoption. Profile-slot and Community-slot designation are **deferred** (named here, not built in #119/#120).

## Community-Score weights (proposed by PRD owner)

Stylesheet activity accrues into the **CRS** along three recipients:

**Site** (overall KPI score; or a specific admin if later specified):

- Default stylesheet (`Sublime`): **0.1415926535** per user on the default theme.
- **×3** if changed to another SysOp/staff stylesheet → that score goes to the **SysOp/designer** staff user.
- **×5** for any non-site-based **Author**.

**User** (rewards organic customization; deliberately not designer-gated):

- Base for setting an AuthorStylesheet to a site default/alternative: **0.1**
- **×2** when non-default
- **×3** when a custom ExternalStylesheet / non-self AuthorStylesheet
- **×5** when it's the user's **own** authored stylesheet
- A user on a modified stylesheet: a **+1** engagement bonus → to Site (or admin), and to the **Author** if a custom InjectedStylesheet.

**Tiering (decided — pinned #121).** The +1 is **both** additive **and** folds into the multipliers as a user **tiers up**: each step of sharing compounds the base rather than paying a flat one-off. The flat multipliers above are **tier 0**. The escalation schedule tiers the **author/popularity axis** — the count of distinct members who have adopted a member's AuthorStylesheets (the deduped `(adopter, author)` ledger from #120) — leaving the user-customization rewards above flat. It is a **discrete tier table** applied **marginally** (tax-bracket: each adoption scores at the rate of the band it falls in, summed — monotonic and cliff-free, so an author's score eases down read-time when a sheet loses adoptions rather than re-rating every past adoption). The curve is **back-loaded within the existing cap (6)**: early adoptions score below the base rate `b` (the non-self author delta ≈ 0.708), the marginal rate climbs each band, and the cap is reached only by sustained popularity (~16 distinct adoptions). Rates are fractions of `b`, so retuning the base rescales the whole curve.

| Tier | Distinct adoptions (band) | Marginal rate / adoption | Cumulative CRS at band end |
| ---- | ------------------------- | ------------------------ | -------------------------- |
| 0    | 0                         | —                        | 0.00                       |
| 1    | 1–3                       | 0.30 × b                 | 0.64                       |
| 2    | 4–8                       | 0.45 × b                 | 2.23                       |
| 3    | 9–15                      | 0.65 × b                 | 5.45                       |
| 4    | 16+                       | 0.85 × b                 | cap 6 reached ~adoption 16 |

Lives in `scoreStylesheetTier` (`stylesheetScore.ts`), wired into the `stylesheet` dimension in `reputation.ts`.

**External disposition (decided, #84).** A `profile.externalStylesheet` that resolves to an author is scored as an **AuthorStylesheet** (credit the author). An **authorless** external `.css` earns the _user_ the customization reward but **nothing to the site** — it's a **prune/investigate** candidate, or, if multiple users share it, a hidden **Community stylesheet**, both handled at the **permission / link-health layer**, not scored here.

**Author** (incentive to design good themes): accrues when others adopt their AuthorStylesheet (exact split TBD with Contests / CommunityStylesheets). **Self-use is not an adoption** — using your own sheet pays the user reward (×5) only, no author bonus (anti-farm, #84).

**Staff** (context): community staff earn **+50 CRS per week served** (Standards/Communities — cross-ref PRD-01).

**Friends × Stylesheet — controlled vector (decided; shipped — [#147](https://github.com/orphic-inc/stellar-api/issues/147) / PR #162).** Adopting another user's AuthorStylesheet is also a weak social/trust edge, so it fires a **second** accrual in PRD-01's **Friends** dimension — _separate from and additive to_ the stylesheet-dimension weights above. The keystone (#120) built the deduped adoption ledger this vector reads from, but wired only the stylesheet dimension; the Friends-dimension accrual is now wired in `reputation.ts` (`friendsScorer` reads both ledger sides):

- **Adopter: +0.2** (rewards active, organic curation — the adopter earns slightly more than the author, to favour participation).
- **Author: +0.1** (recognition that someone vouched for your sheet).
- **Bounded ("controlled"):** counted **once per distinct (adopter, author) pair**, with a per-user cap on total Friends-dimension score this vector can contribute — so ring/sock-puppet mass-adoption flattens out. Plain friending remains the stronger, separate signal; adoption is the weak-tie nudge.
- Fires on **any** adoption (friend or not). The dedup + cap are durable via the CRS event ledger ([ADR-0007](../adr/0007-crs-read-time-and-event-ledger.md)).

**IRC Mutual-Mention × Friends — negative controlled vector (decided, v0.2.x).** The vector above rewards the positive path (adopt → trust signal). This arm penalises the **missing** trust edge: two users who consistently mention each other on IRC over a rolling week but have not friended each other. Channel co-presence alone is not sufficient — being in the same room is not interaction. The trigger is **mutual nick-mention frequency over 7 days**.

- **Detection (requires irc-bridge change):** irc-bridge must track per-message nick mentions — when a user's PRIVMSG contains another tracked nick, emit that as a pairwise `{ from, to, mentionCount }` signal in the flush payload alongside per-user metrics. Stellar-api aggregates these into a rolling 7-day window per (userA, userB) pair. The trigger fires when **both directions** exceed a threshold (TBD — e.g., ≥5 mutual mentions each over 7 days). One-sided mention (fan, lurker) does not trigger it.
- **Base penalty: −0.1** applied once per week to each user's FriendsScore for every unfriended pair that clears the mutual-mention threshold.
- **Stylesheet mitigator:** if both users share the same stylesheet (same site built-in, or both adopters of the same AuthorStylesheet), penalty is halved to **−0.05**. Aesthetic proximity signals latent trust even without the formal Friend edge — they're not strangers.
- **Floor:** total negative contribution from this vector is floored at **−2.0** per user. Separate from and does not interact with the positive Friends-dimension cap.
- **Dedup:** one penalty per (userA, userB) per 7-day rolling window, regardless of mention volume above the threshold.
- **Resolves on friendship:** once mutually friended, the negative stops accruing and the positive adoption vector becomes available.
- **Scope:** does not extend to Forums/Comments at v0.2.x. Thread co-authorship is a weaker signal; deferred.
- **Open: mention threshold** (the ≥5/direction/week figure above is a placeholder — pin before implementation).
- **Ledger:** same `CRS_*` ledger (ADR-0007). Event = weekly penalty per pair; dedup key = (userA, userB, weekStart ISO date).

## Negative scoring (decided — the model needs downside)

Rewards alone let bad actors coast; CRS must be able to go **down**.

- ~~**Dead externalUrl** — an `externalStylesheet` whose link is dead/unreachable is **suspicious → negative CRS** for the user hosting it.~~ **Withdrawn 2026-07-18 (#122 closed wontfix).** The premise does not hold: `UserSettings.externalStylesheet` is owner-only (`profile.ts` returns it solely when `viewer.isOwner`) and themes the holder's own view, so a dead link degrades nobody's experience but the holder's. It is therefore _not_ the stylesheet sibling of contribution link-health — a dead contribution link denies content to other members, which is what makes that penalty a reputational event. A CRS penalty requires community harm. See PRD-01, "Scoping decisions (2026-07-18)". Note that no publicly-consumed stylesheet URL exists at all: `AuthorStylesheet.source` is inline CSS, not a link.
- **Broader negative CRS lives in PRD-01 (lifetime CRS) + the LinkHealth lifecycle**, referenced here so the stylesheet penalty stays consistent with them:
  - flapping / unresolved-in-72h links → penalty then sweep
  - **upheld** reports on contributions → penalty (a heavily-reported user is always suspect)
  - **repeat offenders** → large-scale lifetime CRS penalties (compounding, the downside mirror of tiering)
- PRD-03 scope: the dead-external penalty (magnitude TBD — flagged). The lifetime/repeat-offender curves belong to PRD-01 / PRD-04 LinkHealth lifecycle.

## Anti-abuse

The `/private/`, invite-only model is the primary control: a sock-puppeteer must beat the **Invitation/InviteTree + Communities + Reporting** tooling, not merely a CSS sandbox. The reset/sandbox boundary (ADR-0003) handles the injection-vector half. Adoption legitimacy therefore leans on existing invite-genealogy + report-upheld signals rather than a bespoke cap. _(Confirm: any per-author cap on top of this, or is invite+report sufficient?)_

## Donor add-ons

**$tylesheets — donor-added slots**: donors unlock additional stylesheet slots (ties to PRD-07 Donations / `donor.ts`). **Mechanism decided ([ADR-0032](../adr/0032-authored-stylesheet-member-lifecycle.md) §4):** a donor grant is a secondary rank, and the registry-space quota is the **maximum across a member's primary and secondary ranks** — with `0` anywhere in that set meaning unlimited. Enforcement previously consulted the primary rank only while the auth payload already advertised the maximum, so the feature read as granted and enforced as absent.

## Concept → existing code (the descent map)

| Concept                                             | Lives in                                                                                                                                                          |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CRS / CommunityScore                                | [PRD-01](01-Community-Score.md), [#75](https://github.com/orphic-inc/stellar-api/issues/75), `statsHistory.ts`, `getCommunityHealthPulse`                         |
| Stylesheet model + admin                            | `schemas/stylesheet.ts`, `schemas/profile.ts`, [#34](https://github.com/orphic-inc/stellar-api/issues/34) (closed), stellar-ui `StylesheetInjector`               |
| LinkHealth + bonus                                  | `linkHealth.ts`, `linkHealthJob.ts`, branch `feat/community-health-pulse`                                                                                         |
| ContributionScore / quality                         | [#76](https://github.com/orphic-inc/stellar-api/issues/76), branch `feat/contribution-quality-grade` ([#102](https://github.com/orphic-inc/stellar-api/pull/102)) |
| AccountingLedger / ratio                            | `ratio.ts`, `ratioPolicy.ts`, BigInt sizeInBytes ([#81](https://github.com/orphic-inc/stellar-api/pull/81))                                                       |
| Top10 / Wiki / Announce                             | `top10.ts`, wiki workbench, `schemas/announcement.ts`                                                                                                             |
| **AuthorStylesheetUrl, IRC scoring, exact weights** | **net-new** (this PRD)                                                                                                                                            |

## Out of scope (other PRDs)

- LinkHealth lifecycle (cron/flapping/72h/sweep), MusicModel, Donations/IRC scoring → covered by PRD-01 (CRS dimensions), PRD-02 (IRC), PRD-04, PRD-07 (Donations). Referenced here only where they feed stylesheet scoring.

## Red-green descent targets

First testable slices (much of the substrate already exists):

1. ✅ **Stylesheet selection → CRS accrual** — pure `scoreStylesheetSelection` (no DB), table-driven over each multiplier. **Shipped: [#84](https://github.com/orphic-inc/stellar-api/pull/84)** (tier-0 multipliers; external/self decisions applied).
2. ✅ **Tiering escalation** — the back-loaded marginal curve that compounds the base author reward as a member accrues distinct adoptions. **Shipped: [#121](https://github.com/orphic-inc/stellar-api/issues/121)** (`scoreStylesheetTier`; table + cap-6 calibration in the Tiering decision above).
3. **Dead-external penalty** — link-health-driven negative CRS for a dead `externalStylesheet`; red-green once the penalty magnitude is set.
4. **AuthorStylesheet save → adopt → score** (the keystone — wires shipped `scoreStylesheetSelection` #84 to a real event). Three slices:

   - **4a save (#118, ✅ shipped):** `AuthorStylesheet` model + `POST`/`GET /api/stylesheet/author`.
   - **4b adopt (#119, ✅ shipped):** many-per-author (cardinality fixed here — `@unique authorId` dropped); a viewer adopts a sheet into their **Site Stylesheet** slot (`UserSettings.activeAuthorStylesheetId`) via `POST /api/stylesheet/author-stylesheet/:id/adopt`, idempotent.
   - **4c score (#120, ✅ shipped):** adoption fires `scoreStylesheetSelection`; non-self adoptions write a `CRS_STYLESHEET_ADOPTION` ledger row deduped **once per (adopter, author)** (ADR-0007), and a read-time **stylesheet** CRS dimension counts them → author's global CRS. Self-adoption renders, earns nothing.

   - **4d lifecycle ([ADR-0032](../adr/0032-authored-stylesheet-member-lifecycle.md), decided 2026-07-19):** edit (`PUT /author-stylesheet/:id`) and **soft** delete (`deletedAt`) close the author lifecycle. A soft-deleted sheet frees its registry space and leaves adoption, but keeps serving `/css` to existing adopters so nobody's site changes under them; the CRS ledger is untouched. Authoring is paste/edit-in-place over the existing JSON contract — file upload is UI sugar, never a second byte ingress.

   **Deferred** (named, not built): Profile-slot + Community-slot designation · retention/reaping of soft-deleted sheets (ADR-0032 §3 — out of scope until there is traffic to calibrate a dormancy window) · **byte-identical cross-author dedup** on submit (reject a duplicate sheet under a second author's name; UI offers the existing one — _ADR-when-built_: hard to reverse, needs a content hash + index, "is identical = exact bytes or normalized?" is a real trade-off).

   **Shipped since:** the **Friends×Stylesheet controlled vector** (adopter +0.2 / author +0.1 into the Friends dimension) is now wired — see the §"Friends × Stylesheet" decision above ([#147](https://github.com/orphic-inc/stellar-api/issues/147) / PR #162).

5. **Injection isolation** ([ADR-0031](../adr/0031-injected-css-threat-model.md), superseding ADR-0003) — StylesheetInjector spec in stellar-ui. The defended party is the **non-consenting viewer**, and the store-time `cssValidate` boundary is the sole exfiltration control (the prod CSP constrains execution and fonts, deliberately not images). Arm 1's protected-chrome/global-reset layer was **dropped** (2026-06-23 amendment — CSS cannot lock the cascade against `!important`).

## Open questions

- ~~**Dead-external penalty magnitude** — value TBD (#122).~~ **Resolved 2026-07-18: no penalty ships.** #122 closed wontfix (see Negative scoring above). CRS descent is unaffected — `community` (floor −1) and the contagion vector already provide it.
- IRC scoring belongs to PRD-02 — confirm it's not duplicated here.

**Resolved:** external disposition (authorless → permission/link-health, not site) · self-use pays no author bonus · per-author cap not needed for the stylesheet-dimension author bonus (the `/private` invite+report model covers it) · **accrual model = computed-on-read, with adoption events logged to a `CRS_*` ledger** ([ADR-0007](../adr/0007-crs-read-time-and-event-ledger.md)) · **Friends×Stylesheet controlled vector** (adopter +0.2 / author +0.1, once-per-pair + per-user cap) · **tiering curve** (#121: back-loaded marginal table over distinct adoptions, cap 6 — table above) · **AuthorStylesheet storage shape** ([ADR-0024](../adr/0024-stylesheet-delivery-contract.md): stored sanitized `source`, delivered as `text/css` via `GET /api/stylesheet/author-stylesheet/:id/css`; a distinct URL-typed `AuthorStylesheetUrl` entry is dropped — Personal covers the URL case) · **user contract = `.css` only** (SCSS rejected as user input; ADR-0024) · **Personal/Registry radio** (the Site Stylesheet slot is one explicit source; selecting one clears the other, enforced server-side — retires the "URL overrides" implicit precedence).

**Radio UAT flow (ADR-0024).** Settings shows the Site Stylesheet slot as a two-way radio: **Personal** (`externalStylesheet` https URL) or **Registry** (an authored/adopted `activeAuthorStylesheetId`). Selecting Personal and saving nulls the pointer; selecting Registry and saving nulls the URL. Injector precedence: explicit slot value → `siteAppearance` built-in → Sublime default (no stacking).
