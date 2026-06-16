# PRD-04 — Contribution, Release & Music Model

**Status:** Draft · **Owner:** @obrien-k · **Extends:** [PRD-01 Community-Score / CRS](01-Community-Score.md)
**Numbering:** PRD-01 Community-Score · PRD-02 IRC & Announce · PRD-03 Stylesheets · **PRD-04 Contribution/Release/Music** · PRD-05 Rules & Governance · PRD-06 Ratio · PRD-07 Donations · PRD-08 Collages & Cover Art

> Lean PRD. The structured model has **landed on `main`** (#85 music model + ReleaseArtist/Edition, merged via #98 — `develop` retired in the [ADR-0010](../adr/0010-trunk-based-single-branch-workflow.md) trunk fold), with per-file rip metadata split out to a `ReleaseFile` satellite ([ADR-0008](../adr/0008-contribution-metadata-satellites.md)). The quality grade landed on `feat/contribution-quality-grade` ([#102](https://github.com/orphic-inc/stellar-api/pull/102), supersedes #86). This documents the model + CRS weighting and flags TBDs. Prod is pre-alpha with disposable data, so the model was migrated destructively (no backfill).

## Problem

A **Contribution** is Stellar's unit of shared content within a Community (a hosted Download URL). Today a music Contribution carries a free-text `releaseDescription` standing in for structured release metadata — edition, label, catalogue, format, bitrate, multi-artist credits. Releases are the **primary Contribution type** and a **major CRS driver**, so the model must be air-tight before the Contribution model is generalized to other CommunityTypes (eLearningVideos, Film).

## Structured Release model (replacing free-text)

Modeled on `feat/music-model-edition-tier` (#85):

- **Release** — `type` (ReleaseType), `releaseType` (ReleaseCategory — album/…), `year`, `credits: ReleaseArtist[]`, `editions: Edition[]`.
- **ReleaseArtist** — `artist` + `role: ArtistRole` (default `Main`), unique per (release, artist, role). **ArtistRole**: Main, Guest, Remixer, Composer, Conductor, DJ/Compiler, Producer.
- **Edition** — edition-scoped (per-pressing) metadata: `year`, `recordLabel`, `catalogueNumber`, `media`, `isUnknownEdition` (remaster/reissue/etc.). The album↔edition split keeps tags on the album and pressing details on the edition.
- **ReleaseFile** — per-file (per-Contribution, 1:1) rip metadata for a music Contribution: `bitrate`, `hasLog`, `hasCue`, `isScene`. Kept **off** the generic Contribution spine — it's music-type-specific per-file data. See [ADR-0008](../adr/0008-contribution-metadata-satellites.md).

## Contribution quality (the grade)

Landed on `feat/contribution-quality-grade` ([#102](https://github.com/orphic-inc/stellar-api/pull/102), supersedes #86): `gradeContribution({ type, bitrate, hasLog, hasCue }) → { tier, score }` with a 0–1 weight:

- **Perfect** (1.0) — verified lossless rip (FLAC + log + cue).
- **Lossless** (0.9) — FLAC without log/cue, or WAV.
- **Lossy** — graded by bitrate (320 / V0 / …).

Bitrate is now a typed `Bitrate` enum on `ReleaseFile` (#72, done). The grade reads `Contribution.type` (format) + `ReleaseFile.{hasLog, hasCue, bitrate}` — a contract independent of any other Contribution type.

## CRS implications

Contributions/Releases are a **primary lifetime-CRS driver** — `downloads.ts`, `artist.ts`, `linkHealthJob.ts`, `donorExpiryJob.ts` (primary), with `*.spec.*` as the secondary tier. The quality grade + link-health feed the CommunityScore dimension; the **weighting magnitude is TBD** (ties [PRD-01](01-Community-Score.md) + [ADR-0002](../adr/0002-community-health-pulse.md)).

## Concept → code (descent map)

| Concept                                        | Lives in                                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Release / Edition / ReleaseArtist / ArtistRole | `feat/music-model-edition-tier` (#85) — landed on `main` via #98                                                                     |
| ReleaseFile (per-file rip metadata)            | `schema.prisma` + migration `20260609171357_music_model_release_files` — [ADR-0008](../adr/0008-contribution-metadata-satellites.md) |
| Contribution quality grade                     | `feat/contribution-quality-grade` ([#102](https://github.com/orphic-inc/stellar-api/pull/102), supersedes #86) — `gradeContribution` |
| Release editing surface                        | `releaseWorkbench/*`                                                                                                                 |
| Contribution create + accounting               | `contribution.ts`, `downloads.ts`, `ratio.ts`, sizeInBytes BigInt (#81)                                                              |

## Generalization guardrail

The Release model must be air-tight **before** the Contribution/Community spine is reused for other CommunityTypes (eLearningVideos, Film) — those add type-specific metadata models analogous to `Edition`/`ReleaseFile`, not a parallel Contribution. [ADR-0008](../adr/0008-contribution-metadata-satellites.md) defines the spine / Edition-analog / per-file-satellite tiering.

## Red-green descent targets

1. ~~**Land #85**~~ (done, via #98) + ~~**land the grade**~~ (#102, supersedes #86) — the models, then the grade. The grade reads the `ReleaseFile` satellite.
2. **Quality grade → CRS weight** — pure scoring function (table-driven, mirroring the PRD-03 stylesheet slice) once the weighting is set.
3. ~~**`releaseDescription` → structured fields**~~ — **done**: `POST /contributions` accepts `releaseCategory` → `Release.releaseType`, `recordLabel`/`catalogueNumber`/edition info → `Edition`, and per-artist role credits → `ReleaseArtist`; the accessible stellar-ui contribute form drives them (stellar-api [#113](https://github.com/orphic-inc/stellar-api/pull/113) + stellar-ui [#70](https://github.com/orphic-inc/stellar-ui/pull/70)). `releaseDescription` is **kept as an optional supplement** (resolves the open question below).
4. ~~**Type the bitrate** (#72)~~ — **done**: `Bitrate` enum on the `ReleaseFile` satellite ([ADR-0008](../adr/0008-contribution-metadata-satellites.md)).

## Open questions

- Confirm the enum sets: `ReleaseType`, `ReleaseCategory`, `ArtistRole`, edition tiers.
- ~~Keep `releaseDescription` free-text as a supplement alongside the structured fields, or drop it?~~ **Resolved: kept as an optional supplement** (descent target #3).
- Quality-grade → CRS magnitude (TBD; PRD-01 / ADR-0002).
- ~~Does the `releaseDescription`→structured migration warrant its own ADR?~~ — **yes**: [ADR-0008](../adr/0008-contribution-metadata-satellites.md) records the Contribution spine / Edition / per-file-satellite tiering.
