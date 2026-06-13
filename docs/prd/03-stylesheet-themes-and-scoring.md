# PRD-03 — Stylesheet Themes & Scoring

**Status:** Draft · **Owner:** @obrien-k
**Extends:** [PRD-01 Community-Score / CRS](01-Community-Score.md) · **Decisions:** [ADR-0002 community-health-pulse → CRS](../adr/0002-community-health-pulse.md) (accrual model), [ADR-0003 stylesheet injection isolation](../adr/0003-stylesheet-injection-isolation.md)
**Numbering:** PRD-01 Community-Score · PRD-02 Donations/IRC/Announce · **PRD-03 Stylesheets** · PRD-04 Contribution/Release/Music

> Lean PRD. Captures the decided shape + the Community-Score weights, flags TBDs, and maps each concept to existing code so this becomes a red-green descent, not greenfield. Stylesheet scoring is a **dimension of PRD-01's CRS**, not a separate score.

## Problem

Stellar is an invite-only `/private/` community site. Users want to theme their own profile and the site (the universal theme), publish their own stylesheet for others, and be rewarded for organic customization/sharing — without opening an injection vector.

## Stylesheet types

| Type                                       | Meaning                                                                                                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Built-in / site stylesheets**            | Seeded themes: `kuro`, `layer-cake`, `postmod`, `proton`, `sublime`. **Sublime = default/base + selectable + contest reference** (net-new authoring; reset target).                  |
| **ExternalStylesheet**                     | A URL on the user's profile (`profile.externalStylesheet`).                                                                                                                          |
| **AuthorStylesheet / AuthorStylesheetUrl** | A user-authored `.scss`/`.css` saved for others to adopt. **Many per author** (cardinality decided 2026-06-13; rank-gated *count limit* deferred). The author is a **StylesheetAuthor** — shorthand for any member who has authored one, not a distinct role. |
| **CommunityStylesheet**                    | Community-scoped theme, set by that Community's Staff; rendered to any viewer on that community's pages. Slot deferred (TBD — tied to Contests / Community Toolbox).                  |
| **Global SCSS/CSS reset flag**             | Per-injection boundary so a user sheet can't leak into app chrome (see ADR-0003).                                                                                                    |

### Slots & cascade (decided 2026-06-13)

A stylesheet renders by being placed into one of three single-valued **slots**, selected by **page context** — not a single global "active theme":

| Slot                     | Set by                | Rendered when                                            |
| ------------------------ | --------------------- | ------------------------------------------------------- |
| **Profile Stylesheet**   | the profile's owner   | any viewer is on *that owner's* profile page            |
| **Site Stylesheet**      | the viewer            | the viewer is on the general site                       |
| **Community Stylesheet** | that Community's Staff | any viewer is on *that* community's pages                |

**Precedence is page-context-first:** a Profile or Community page shows its own slot to *every* viewer, regardless of the viewer's Site Stylesheet. On the general site the viewer sees their own Site Stylesheet, falling back to the **Site Theme** (`Sublime`/Default) when they have not adopted one. A member has exactly one stylesheet per slot.

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
- **×3** when a custom ExternalStylesheet / non-self AuthorStylesheet(Url)
- **×5** when it's the user's **own** authored stylesheet
- A user on a modified stylesheet: a **+1** engagement bonus → to Site (or admin), and to the **Author** if a custom InjectedStylesheet.

**Tiering (decided).** The +1 is **both** additive **and** folds into the multipliers as a user **tiers up** — engagement escalates like the [`/verbiagating`](../../../skills) tier ladder: each step of customization/sharing compounds the base rather than paying a flat one-off. The flat multipliers above are **tier 0**; the escalation schedule (the curve as a user climbs tiers) is the **next scoring slice** — curve TBD.

**External disposition (decided, #84).** A `profile.externalStylesheet` that resolves to an author is scored as an **AuthorStylesheet** (credit the author). An **authorless** external `.css/.scss` earns the _user_ the customization reward but **nothing to the site** — it's a **prune/investigate** candidate, or, if multiple users share it, a hidden **Community stylesheet**, both handled at the **permission / link-health layer**, not scored here.

**Author** (incentive to design good themes): accrues when others adopt their AuthorStylesheet (exact split TBD with Contests / CommunityStylesheets). **Self-use is not an adoption** — using your own sheet pays the user reward (×5) only, no author bonus (anti-farm, #84).

**Staff** (context): community staff earn **+50 CRS per week served** (Standards/Communities — cross-ref PRD-01).

**Friends × Stylesheet — controlled vector (decided).** Adopting another user's AuthorStylesheet is also a weak social/trust edge, so it fires a **second** accrual in PRD-01's **Friends** dimension — *separate from and additive to* the stylesheet-dimension weights above:

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

- **Dead externalUrl** — an `externalStylesheet` whose link is dead/unreachable is **suspicious → negative CRS** for the user hosting it (link-health driven). This is the stylesheet sibling of contribution link-health: a dead link isn't neutral, it's a penalty.
- **Broader negative CRS lives in PRD-01 (lifetime CRS) + the LinkHealth lifecycle**, referenced here so the stylesheet penalty stays consistent with them:
  - flapping / unresolved-in-72h links → penalty then sweep
  - **upheld** reports on contributions → penalty (a heavily-reported user is always suspect)
  - **repeat offenders** → large-scale lifetime CRS penalties (compounding, the downside mirror of tiering)
- PRD-03 scope: the dead-external penalty (magnitude TBD — flagged). The lifetime/repeat-offender curves belong to PRD-01 / PRD-04 LinkHealth lifecycle.

## Anti-abuse

The `/private/`, invite-only model is the primary control: a sock-puppeteer must beat the **Invitation/InviteTree + Communities + Reporting** tooling, not merely a CSS sandbox. The reset/sandbox boundary (ADR-0003) handles the injection-vector half. Adoption legitimacy therefore leans on existing invite-genealogy + report-upheld signals rather than a bespoke cap. _(Confirm: any per-author cap on top of this, or is invite+report sufficient?)_

## Donor add-ons

**$tylesheets — donor-added slots**: donors unlock additional stylesheet slots (ties to PRD-02 Donations / `donor.ts`).

## Concept → existing code (the descent map)

| Concept                                             | Lives in                                                                                                                                            |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| CRS / CommunityScore                                | [PRD-01](01-Community-Score.md), [#75](https://github.com/orphic-inc/stellar-api/issues/75), `statsHistory.ts`, `getCommunityHealthPulse`           |
| Stylesheet model + admin                            | `schemas/stylesheet.ts`, `schemas/profile.ts`, [#34](https://github.com/orphic-inc/stellar-api/issues/34) (closed), stellar-ui `StylesheetInjector` |
| LinkHealth + bonus                                  | `linkHealth.ts`, `linkHealthJob.ts`, branch `feat/community-health-pulse`                                                                           |
| ContributionScore / quality                         | [#76](https://github.com/orphic-inc/stellar-api/issues/76), branch `feat/contribution-quality-grade` ([#102](https://github.com/orphic-inc/stellar-api/pull/102))                                               |
| AccountingLedger / ratio                            | `ratio.ts`, `ratioPolicy.ts`, BigInt sizeInBytes ([#81](https://github.com/orphic-inc/stellar-api/pull/81))                                         |
| Top10 / Wiki / Announce                             | `top10.ts`, wiki workbench, `schemas/announcement.ts`                                                                                               |
| **AuthorStylesheetUrl, IRC scoring, exact weights** | **net-new** (this PRD)                                                                                                                              |

## Out of scope (other PRDs)

- LinkHealth lifecycle (cron/flapping/72h/sweep), MusicModel, Donations/IRC scoring → covered by PRD-01 (CRS dimensions), PRD-02, PRD-04. Referenced here only where they feed stylesheet scoring.

## Red-green descent targets

First testable slices (much of the substrate already exists):

1. ✅ **Stylesheet selection → CRS accrual** — pure `scoreStylesheetSelection` (no DB), table-driven over each multiplier. **Shipped: [#84](https://github.com/orphic-inc/stellar-api/pull/84)** (tier-0 multipliers; external/self decisions applied).
2. **Tiering escalation** — the curve that compounds the base multipliers as a user climbs tiers (the `/verbiagating`-style ladder). Next slice; curve TBD.
3. **Dead-external penalty** — link-health-driven negative CRS for a dead `externalStylesheet`; red-green once the penalty magnitude is set.
4. **AuthorStylesheet save → adopt → score** (the keystone — wires shipped `scoreStylesheetSelection` #84 to a real event). Three slices:
   - **4a save (#118, ✅ shipped):** `AuthorStylesheet` model + `POST`/`GET /api/stylesheet/author`.
   - **4b adopt (#119, ✅ shipped):** many-per-author (cardinality fixed here — `@unique authorId` dropped); a viewer adopts a sheet into their **Site Stylesheet** slot (`UserSettings.activeAuthorStylesheetId`) via `POST /api/stylesheet/author-stylesheet/:id/adopt`, idempotent.
   - **4c score (#120, ✅ shipped):** adoption fires `scoreStylesheetSelection`; non-self adoptions write a `CRS_STYLESHEET_ADOPTION` ledger row deduped **once per (adopter, author)** (ADR-0007), and a read-time **stylesheet** CRS dimension counts them → author's global CRS. Self-adoption renders, earns nothing.

   **Deferred** (named, not built): Profile-slot + Community-slot designation · rank-gated stylesheet **count limit** · **byte-identical cross-author dedup** on submit (reject a duplicate sheet under a second author's name; UI offers the existing one — *ADR-when-built*: hard to reverse, needs a content hash + index, "is identical = exact bytes or normalized?" is a real trade-off).
5. **Injection isolation** (ADR-0003) — StylesheetInjector spec in stellar-ui asserting the global reset boundary.

## Open questions

- AuthorStylesheetUrl storage shape (URL vs stored file) — pending ExternalStylesheet + global-reset findings.
- **Tiering curve** + **dead-external penalty magnitude** — values TBD.
- IRC scoring belongs to PRD-02 — confirm it's not duplicated here.

**Resolved:** external disposition (authorless → permission/link-health, not site) · self-use pays no author bonus · per-author cap not needed for the stylesheet-dimension author bonus (the `/private` invite+report model covers it) · **accrual model = computed-on-read, with adoption events logged to a `CRS_*` ledger** ([ADR-0007](../adr/0007-crs-read-time-and-event-ledger.md)) · **Friends×Stylesheet controlled vector** (adopter +0.2 / author +0.1, once-per-pair + per-user cap).
