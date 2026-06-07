# PRD-03 — Stylesheet Themes & Scoring

**Status:** Draft · **Owner:** @obrien-k
**Extends:** [PRD-01 Community-Score / CRS](01-Community-Score.md) · **Decision:** [ADR-0003 stylesheet injection isolation](../adr/0003-stylesheet-injection-isolation.md)
**Numbering:** PRD-01 Community-Score · PRD-02 Donations/IRC/Announce · **PRD-03 Stylesheets** · PRD-04 Contribution/Release/Music

> Lean PRD. Captures the decided shape + the Community-Score weights, flags TBDs, and maps each concept to existing code so this becomes a red-green descent, not greenfield. Stylesheet scoring is a **dimension of PRD-01's CRS**, not a separate score.

## Problem

Stellar is an invite-only `/private/` community site. Users want to theme their own profile and the site (the universal theme), publish their own stylesheet for others, and be rewarded for organic customization/sharing — without opening an injection vector.

## Stylesheet types

| Type                                       | Meaning                                                                                                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Built-in / site stylesheets**            | Seeded themes: `kuro`, `layer-cake`, `postmod`, `proton`, `sublime`. **Sublime = default/base + selectable + contest reference** (net-new authoring; reset target).                  |
| **ExternalStylesheet**                     | A URL on the user's profile (`profile.externalStylesheet`).                                                                                                                          |
| **AuthorStylesheet / AuthorStylesheetUrl** | A user-authored `.scss`/`.css` (one per author) saved for others to adopt. **Shape TBD** — depends on ExternalStylesheet + global-reset findings against the current Tailwind theme. |
| **CommunityStylesheet**                    | Community-scoped theme (TBD — tied to Contests).                                                                                                                                     |
| **Global SCSS/CSS reset flag**             | Per-injection boundary so a user sheet can't leak into app chrome (see ADR-0003).                                                                                                    |

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
- A user on a modified stylesheet: **+1** CRS → to Site (or admin), and to the **Author** if a custom InjectedStylesheet.

**Author** (incentive to design good themes): accrues when others adopt their AuthorStylesheet (exact split TBD with Contests / CommunityStylesheets).

**Staff** (context): community staff earn **+50 CRS per week served** (Standards/Communities — cross-ref PRD-01).

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
| ContributionScore / quality                         | [#76](https://github.com/orphic-inc/stellar-api/issues/76), branch `feat/contribution-quality-signal`                                               |
| AccountingLedger / ratio                            | `ratio.ts`, `ratioPolicy.ts`, BigInt sizeInBytes ([#81](https://github.com/orphic-inc/stellar-api/pull/81))                                         |
| Top10 / Wiki / Announce                             | `top10.ts`, wiki workbench, `schemas/announcement.ts`                                                                                               |
| **AuthorStylesheetUrl, IRC scoring, exact weights** | **net-new** (this PRD)                                                                                                                              |

## Out of scope (other PRDs)

- LinkHealth lifecycle (cron/flapping/72h/sweep), MusicModel, Donations/IRC scoring → covered by PRD-01 (CRS dimensions), PRD-02, PRD-04. Referenced here only where they feed stylesheet scoring.

## Red-green descent targets

First testable slices (much of the substrate already exists):

1. **Stylesheet selection → CRS accrual** — pure scoring function over the weights above (unit-testable, no DB): table-driven red-green on each multiplier (default/non-default/external/self/author).
2. **AuthorStylesheet save + adopt** — model + endpoint (extends `schemas/stylesheet.ts`); integration test for adopt → author/site accrual.
3. **Injection isolation** (ADR-0003) — StylesheetInjector spec in stellar-ui asserting the global reset boundary.

## Open questions

- AuthorStylesheetUrl storage shape (URL vs stored file) — pending ExternalStylesheet + global-reset findings.
- Whether stylesheet-score accrual is computed-on-read (mirror the pulse) or event-logged.
- Per-author adoption cap on top of invite+report, or not.
- IRC scoring belongs to PRD-02 — confirm it's not duplicated here.
