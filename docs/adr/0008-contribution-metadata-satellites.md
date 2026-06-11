# Type-specific Contribution metadata lives in satellite models

**Status: Accepted.** Resolves PRD-04's open question ("Does the `releaseDescription`→structured migration warrant its own ADR?") and records where each music field belongs on the generalized [Contribution](../prd/04-contribution-release-music.md) spine. Implemented by migration `20260609171357_music_model_release_files` (the `ReleaseFile` satellite).

## Context

A **Contribution** is Stellar's unit of shared content within a Community (a hosted Download URL). It is the **polymorphic spine**: a music Release is the primary Contribution type today, but the same spine is meant to carry other CommunityTypes — Film, eLearningVideos, and the deferred ApiPlugin / StylesheetPlugin / ApiApplication types.

The spine had regressed toward "Releases are king": music-specific columns (`bitrate`, `hasLog`, `hasCue`, `isScene`, and `media`) sat directly on `Contribution`. That blocks adding any non-music type without either nulls-everywhere pollution of the generic table or — worse — forking a parallel Contribution table per type.

PRD-04's generalization guardrail already states the intended shape: future types "add type-specific metadata models **analogous to `Edition`, not a parallel Contribution**." This ADR makes that concrete for _per-file_ attributes and fixes where each music field lives.

## Decision

Every Contribution attribute belongs to exactly one of three tiers:

1. **Spine (`Contribution`)** — generic, type-agnostic facts every Contribution has regardless of type: ids, `downloadUrl`, `sizeInBytes`, accounting bytes, `linkStatus`, timestamps, and `type` (the `FileType` _format_ discriminator, which spans `flac`/`mp4`/`pdf`/`exe`/… across all types).
2. **Shared type metadata (Edition-analog)** — "what the content is," shared across the files of one work. For music: `Release` / `Edition` (`year`, `recordLabel`, `catalogueNumber`, `media`). Per-pressing — many Contributions map to one Edition.
3. **Per-file type metadata (satellite, 1:1 with Contribution)** — type-specific facts about the one uploaded file. For music: **`ReleaseFile`** (`bitrate`, `hasLog`, `hasCue`, `isScene`) — the rip fingerprint the quality grade reads.

The placement test for a type-specific attribute: **per-pressing → Edition-analog; per-file → satellite; type-agnostic → spine.** So `media` (per-pressing) is on `Edition`; `bitrate`/`hasLog`/`hasCue`/`isScene` (per-file) are on `ReleaseFile`; `type` (format, every type has one) stays on the spine.

Future Contribution types add **their own** satellite (analogous to `ReleaseFile`) and, where they have a shared "work" concept, their own Edition-analog. **They never fork `Contribution`.**

## Consequences

- Adding a non-music Contribution type touches **no music columns** — the spine stays clean and the new type carries only its own satellite.
- The quality grade (PRD-04, #86) reads `spine.type` + `releaseFile.{hasLog, hasCue, bitrate}` — a stable contract independent of any other type's metadata.
- API responses nest the satellite (`releaseFile`) alongside `release`/`edition`, consistent with existing nesting; the submit **input** stays flat for ergonomics and the contribution module maps it into the nested write.
- Cost is one 1:1 row (and one join on read) per music Contribution — negligible.
- Because prod is **pre-alpha with disposable data**, this was delivered as a single destructive migration with **no backfill**; the prior expand→contract two-step (whose only purpose was a backfill window) was collapsed into one clean migration.
