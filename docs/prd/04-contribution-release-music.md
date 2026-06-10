# PRD-04 — Contribution, Release & Music Model

**Status:** Draft · **Owner:** @obrien-k · **Extends:** [PRD-01 Community-Score / CRS](01-Community-Score.md)
**Numbering:** PRD-01 Community-Score · PRD-02 Donations/IRC/Announce · PRD-03 Stylesheets · **PRD-04 Contribution/Release/Music**

> Lean PRD. The structured model already exists in code (branches #85 / #102) — this documents it + the CRS weighting and flags TBDs. Land the branches, then descend the scoring red-green.

## Problem

A **Contribution** is Stellar's unit of shared content within a Community (a hosted Download URL). Today a music Contribution carries a free-text `releaseDescription` standing in for structured release metadata — edition, label, catalogue, format, bitrate, multi-artist credits. Releases are the **primary Contribution type** and a **major CRS driver**, so the model must be air-tight before the Contribution model is generalized to other CommunityTypes (eLearningVideos, Film).

## Structured Release model (replacing free-text)

Modeled on `feat/music-model-edition-tier` (#85):

- **Release** — `type` (ReleaseType), `releaseType` (ReleaseCategory — album/…), `year`, `credits: ReleaseArtist[]`, `editions: Edition[]`.
- **ReleaseArtist** — `artist` + `role: ArtistRole` (default `Main`), unique per (release, artist, role). **ArtistRole**: Main, Guest, Remixer, Composer, Conductor, DJ/Compiler, Producer.
- **Edition** — edition-scoped metadata: `year`, `recordLabel`, `catalogueNumber`, `isUnknownEdition` (remaster/reissue/etc.). The album↔edition split keeps tags on the album and pressing details on the edition.

## Contribution quality (the grade)

Landed on `feat/contribution-quality-grade` ([#102](https://github.com/orphic-inc/stellar-api/pull/102), supersedes #86): `gradeContribution({ type, bitrate, hasLog, hasCue }) → { tier, score }` with a 0–1 weight:

- **Perfect** (1.0) — verified lossless rip (FLAC + log + cue).
- **Lossless** (0.9) — FLAC without log/cue, or WAV.
- **Lossy** — graded by bitrate (320 / V0 / …).

Bitrate is free-text today; typing it is the music-model coupling (#72).

## CRS implications

Contributions/Releases are a **primary lifetime-CRS driver** — `downloads.ts`, `artist.ts`, `linkHealthJob.ts`, `donorExpiryJob.ts` (primary), with `*.spec.*` as the secondary tier. The quality grade + link-health feed the CommunityScore dimension; the **weighting magnitude is TBD** (ties [PRD-01](01-Community-Score.md) + [ADR-0002](../adr/0002-community-health-pulse.md)).

## Concept → code (descent map)

| Concept                                        | Lives in                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| Release / Edition / ReleaseArtist / ArtistRole | `feat/music-model-edition-tier` (#85)                                   |
| Contribution quality grade                     | `feat/contribution-quality-grade` ([#102](https://github.com/orphic-inc/stellar-api/pull/102), supersedes #86) — `gradeContribution` |
| Release editing surface                        | `releaseWorkbench/*`                                                    |
| Contribution create + accounting               | `contribution.ts`, `downloads.ts`, `ratio.ts`, sizeInBytes BigInt (#81) |

## Generalization guardrail

The Release model must be air-tight **before** the Contribution/Community spine is reused for other CommunityTypes (eLearningVideos, Film) — those add type-specific metadata models analogous to `Edition`, not a parallel Contribution.

## Red-green descent targets

1. **Land #85 + #102** (rebase onto develop) — the models + the grade (#102 merged supersedes #86).
2. **Quality grade → CRS weight** — pure scoring function (table-driven, mirroring the PRD-03 stylesheet slice) once the weighting is set.
3. **`releaseDescription` → structured fields** — migration + stellar-ui form (keep free-text as an optional supplement? — TBD).
4. **Type the bitrate** (#72) so the grade is exact.

## Open questions

- Confirm the enum sets: `ReleaseType`, `ReleaseCategory`, `ArtistRole`, edition tiers.
- Keep `releaseDescription` free-text as a supplement alongside the structured fields, or drop it?
- Quality-grade → CRS magnitude (TBD; PRD-01 / ADR-0002).
- Does the `releaseDescription`→structured migration warrant its own ADR?
