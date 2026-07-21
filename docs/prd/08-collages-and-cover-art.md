# PRD-08 — Collages & Cover Art

**Status:** Draft · **Owner:** @obrien-k
**Extends:** [PRD-01 Community-Score / CRS](01-Community-Score.md) (contribution weighting) · **Relates:** [PRD-03 Stylesheets](03-stylesheet-themes-and-scoring.md) (CommunityStylesheet ↔ Collage/Contest), [PRD-04 Contribution/Release/Music](04-contribution-release-music.md) (Edition/lossless model — forthcoming)
**Decisions:** stellar-ui [ADR-0001 Injected Theme Contract](../../../stellar-ui/docs/adr/0001-injected-theme-contract.md) (the `data-st` / `--st-*` contract the Collage surface targets)
**Numbering:** PRD-01 Community-Score · PRD-02 IRC & Announce · PRD-03 Stylesheets · PRD-04 Contribution/Release/Music · PRD-05 Rules & Governance · PRD-06 Ratio · PRD-07 Donations · **PRD-08 Collages & Cover Art**

> Lean PRD. Captures the decided shape of a Collage surface, anchored to a **measured corpus** rather than a greenfield guess, and maps each concept to existing code so this is a red-green descent.

## Problem

A Collage groups Releases around a theme (a label's roster, a forum thread, a chart). Today's `stellar-ui` `CollageDetail` renders a flat list — title + artist + "added by" — which throws away most of what makes a Collage worth building: the Edition richness of each Release, who actually carried the curation, and Cover Art as a browsable surface. We need a decided shape for the Collage surface and how its activity feeds the CRS.

## Wireframe corpus (source of truth)

The field inventory and the activity model are **not invented here** — they're reduced from two real, fully-built reference collages (269 + 330 Releases, 1370 + 593 Editions) parsed into:

- `stellar-ui/docs/data/collage-corpus.json` — every Release + Edition + contributor + comment
- `stellar-ui/docs/data/collage-analysis.json` — format/category histograms, lossless %, contributor weight-share
- `stellar-ui/docs/data/README.md` — the source→Stellar field map + the three load-bearing patterns

Three patterns the corpus makes non-negotiable:

1. **A Release is a stack of Editions** (format / encoding / media), with **lossless** as the headline quality axis. The Collage row must disclose this, not collapse it. _(Edition model: PRD-04.)_
2. **Contribution is power-law.** Every healthy Collage has one or two curators carrying the bulk (one curator 261/330 ≈ 88%; another 90/126 ≈ 71%) over a long tail. The surface must credit **both** — and this weight is exactly the contribution signal **[PRD-01 CRS](01-Community-Score.md)** rewards (`ContributionScore` dimension).
3. **Discussion is part of the artifact.** Comments are where CommunityLeaders/CommunityStaff curate and report; they carry activity weight alongside entry contributions.

## Collage categories (existing)

`stellar-ui` already enumerates them (`CollageDetail.tsx`): `0` Personal · `1` Theme/Genre · `2` Discography · `3` Label · `4` Charts · `5` Staff Picks · `6` Other. Category `0` (Personal) and locked state already gate entry management — keep.

## Scope

**Cover Art** — first-class weighted mosaic (lead cell may span), not a 12-thumb strip; scroll-to-Release on click (already stubbed). Hook: `[data-st="coverart-*"]`.
**Collage detail** — Release rows that disclose an **Edition stack** with lossless emphasis; **Top Contributors** box with weight bars; computed **Top Artists / Top Tags** rollups; optional **Collector** (download-in-preferred-format) affordance. Hooks: `[data-st="release-*" | "edition-*" | "contributor-*" | "rollup" | "collector"]`.
**Activity → CRS** — Collage entry-adds + comments accrue to the contributor's `ContributionScore` (PRD-01), weighted by the power-law share above. Exact weights: TBD with PRD-01.

## Concept → existing code (the descent map)

| Concept                        | Lives in                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Collage CRUD / entries / subs  | `stellar-api` collage routes; `stellar-ui` `collageApi.ts`, `components/collages/`                                                          |
| Collage detail surface         | `stellar-ui` `CollageDetail.tsx` (flat today — the gap)                                                                                     |
| **Edition / lossless model**   | **PRD-04** (Contribution/Release/Music) — net-new                                                                                           |
| Contribution weighting → CRS   | [PRD-01](01-Community-Score.md) `ContributionScore`, `statsHistory.ts`                                                                      |
| Theme contract for the surface | stellar-ui [ADR-0001](../../../stellar-ui/docs/adr/0001-injected-theme-contract.md), `src/global.css` (`data-st` hooks seeded for this PRD) |
| CommunityStylesheet ↔ Collage | [PRD-03](03-stylesheet-themes-and-scoring.md) (CommunityStylesheet is "Community-scoped theme — tied to Contests")                          |
| Comments                       | `stellar-ui` `CommentsSection`                                                                                                              |

## Red-green descent targets

1. **Cover-art mosaic** — weighted grid against `[data-st="coverart-*"]` (UI-only; data already present).
2. **Edition disclosure** — Release row → Edition stack; needs the PRD-04 Edition shape on the API.
3. **Top Contributors weighting** — compute per-contributor entry share; render weight bars (`[data-st="contributor-*"]`); same number that feeds PRD-01 CRS.
4. **Computed rollups** — Top Artists / Top Tags on read (mirror the reference layout's boxes).

## Open questions

- Edition/lossless model ownership — **PRD-04**; this PRD consumes it, doesn't define it.
- Contributor-weight → `ContributionScore` exact weighting — **with PRD-01**.
- Is `Collector` (bulk download in preferred format) in scope v1, or deferred?
- CommunityStylesheet scoping to a Collage/Contest — **with PRD-03**.

**Resolved:** the surface targets the `data-st`/`--st-*` contract (ADR-0001), not Tailwind overrides · the field inventory + activity model come from the measured corpus, not greenfield.
