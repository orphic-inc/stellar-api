# Model music releases in three tiers driven by the upload form; edition data is edition-scoped

**Status:** Accepted (2026-06-10). Implemented — `Release` carries `ReleaseArtist` role credits and `Edition[]` in place of the single `artistId` and untyped `edition Json?`, and per-file encoding moved to the `ReleaseFile` satellite. Where each type-specific field belongs is recorded in [ADR-0008](0008-contribution-metadata-satellites.md); the generalized Contribution spine is [PRD-04](../prd/04-contribution-release-music.md).

The music contribution model has drifted from the thing that defines a release —
the upload form. The form captures **Artist(s) with a role** (Main, Guest, …), a
**release** (title, year, type, label, catalogue №), an **edition** (remaster /
reissue / country / media), and the **encoding** (format, bitrate, scene, log,
cue). The schema collapses that: `Release` carries a single `artistId`, an
untyped `edition Json?` (passed around as `as never`), and free-string
`Contribution.bitrate` / `media`. Untyped/uni-artist shapes let inconsistent
data into the corpus and can't express a feature, a compilation, or two editions
of one release.

We model the form's tiers explicitly: **Artist —(role)→ Release —→ Edition —→
Contribution.**

- A `ReleaseArtist` join with an `ArtistRole` enum replaces the single
  `Release.artistId` — a release can credit several artists by role.
- An `Edition` tier sits between `Release` and `Contribution`. Edition-scoped
  metadata — remaster/reissue title, year, record label, catalogue № — moves
  off `Release` onto `Edition`. The form's own rule is the invariant: edition
  info belongs to the edition, **never** the release title.
- `Contribution` keeps the encoding (format, scene, log, cue) with typed
  `Bitrate` / `ReleaseMedia` enums replacing the free strings.

Migration is **expand → backfill → contract**: add the new tables/columns,
backfill each release to one Main credit + a default edition (lifting today's
`edition Json` and label/catalogue down), then drop the old columns once the
~16 consuming modules cut over. This keeps `tsc` green throughout.

This is sequenced **after** the community-health pulse ([0002](0002-community-health-pulse.md)),
which the current shape already feeds — the remodel refines, it does not gate.
Execution is tracked in #72 (schema), #73 (regenerate corpus), #74 (module
migration); the existing generated corpus stays valid for non-Music communities
until then.
