# Official tags annotate an open vocabulary

**Status: Accepted (2026-09-21).** Accepted as the gate on [#298](https://github.com/orphic-inc/stellar-api/issues/298), whose implementation follows this contract rather than preceding it — the posture [ADR-0023](0023-contribution-package-and-releasegroup-identity.md), [ADR-0036](0036-release-identity-is-community-private.md) and [ADR-0037](0037-group-dedup-is-a-read-time-projection.md) each took on their issues. It is the first record of anything in the tag domain; the alias table shipped undocumented and this document does not retroactively specify it, only the one interaction it now has with curation.

## Context

Tag aliases are live — `modules/tag.ts`'s `resolveTagName`/`resolveTagNames` redirect a bad name to a good one at write time, and `routes/api/tagAliases.ts` manages the table behind `tags_manage`. What was missing is a curated set: nothing said which of the tags that exist are the ones worth offering.

**The issue's premise was too strong, and its blueprint mis-stated its own precedent.** #298 said "nothing distinguishes the canonical browse/discovery tag set from freeform member tags". Something does — `Tag.occurrences`, which `getTopTags` already orders by (`modules/top10.ts:558`). But **popularity ranks; curation selects.** A tag can be popular and useless, or rare and canonical, so neither derives the other and the gap the issue names is real even though the sentence naming it is not.

The blueprint attached to the issue closed by saying a genre/other tag-type split "was considered and dropped — no consumer". In the legacy implementation that split **is** how official-ness is stored: `tags.TagType enum('genre','other')`, promoted and demoted by the Official Tags Manager. A two-value enum and a boolean are isomorphic, so the blueprint's decision stands — but its stated reason is backwards, and the "no consumer" test it applied is the one the flag itself nearly failed.

Four facts from the legacy implementation decided the rest.

**Official-ness has four consumers there, and all of them are member-facing**: a picker on the upload form and on the request form, a genre dropdown on browse, and tag autocomplete. None of them is a badge — `Tags::format()` renders every tag as an identical link, so a release page cannot tell a canonical tag from any other.

**The picker appends to a free-text field rather than replacing it** (`static/functions/upload.js:60`). The vocabulary is open; the canonical set is one click away, not compulsory.

**Autocomplete unions curation with popularity rather than overriding it**: `WHERE (Uses > 700 OR TagType = 'genre') ORDER BY TagType = 'genre' DESC, Uses DESC`. A rare official tag is offered anyway; a popular unofficial one still appears, below it.

**Promotion creates the tag when it is absent**, at zero uses. Curators author a vocabulary rather than endorsing whatever members happened to invent — which matters most on a fresh install, where there are no tags to endorse.

One fact from this repository shaped the interaction with aliases. **`TagAlias.badTag` is a free `String @unique` with no foreign key to `Tag`.** So a tag can be marked canonical and simultaneously be the bad half of an alias, leaving it official while the normalizer rewrites it at every write. Nothing prevents that today and nothing notices; the legacy implementation has both mechanisms and its curation manager consults neither.

## Decision

### 1. `isOfficial` annotates an open vocabulary and never closes it

Members keep minting tags freely. `contribution.ts:185` and `releaseWorkbench/tags.ts:39` both upsert whatever arrives, and this ADR changes neither. A picker built on the curated set offers it; it does not restrict what may be typed beside it.

This is the decision most likely to be quietly reversed later, because "only official tags may be used" reads like the obvious next step. It is not. Closing the vocabulary moves every new tag through a staff queue, which is a different product with a different failure mode — releases going untagged while they wait.

### 2. Curation selects; popularity ranks. They are independent

`isOfficial` is not an override of `occurrences` and is not derived from it. A curated tag with zero uses is ordinary and expected — promotion mints at `occurrences: 0`, which keeps it out of `getTopTags`'s `occurrences > 0` filter until a release actually carries it.

When autocomplete is built, it unions the two rather than choosing between them, and official sorts first:

```
where: (occurrences > N OR isOfficial) — order by isOfficial desc, occurrences desc
```

That rule is recorded here rather than left to be rediscovered, because the tempting simplification — official tags only — makes autocomplete useless on a site whose curated set is still small, and the other one — popularity only — is what the flag exists to correct.

### 3. An official tag may not be aliased away

`POST /api/tag-aliases` and `PUT /api/tag-aliases/:id` refuse a `badTag` naming an official tag, with a `409` that says which. The reverse direction resolves instead of refusing: promotion runs the name through `resolveTagName` first, so promoting an aliased name promotes the good tag and the response says which name it landed on.

The asymmetry is deliberate. Promoting an aliased name is a curator reaching for the right concept under the wrong spelling, and the normalizer already knows the answer. Aliasing an official tag away is one staff action silently undoing another, and there is no answer to infer — only a choice between two staff decisions, which the person making it should make knowingly.

### 4. `isOfficial` lives on the tags router only

It appears on `GET /tags` and `GET /tags/official`, and on nothing else. It does **not** join `ReleaseTagEnriched` or the `{ id, name, occurrences }` projection that `releaseTags.ts` feeds to browse, detail and the workbench.

A release page has no use for it — the legacy one cannot distinguish a canonical tag either — and the pickers that do need the vocabulary fetch it from `/tags/official` rather than inferring it from whatever tags a release happens to carry. Adding it to the release projections would be four `select` clauses and two builders in service of a badge nobody asked for.

### 5. Names are folded on the promote path only

> **Superseded by [ADR-0047](0047-a-tag-name-has-one-canonical-form.md)** (#689): every tag name now takes one canonical form, on every path. This section is kept as it was written.

`foldTagName` lowercases and trims, and only `promoteTag` calls it. Tag names are unnormalized site-wide: `Tag.name` is case-sensitive in Postgres, `normalizeTags` (`contribution.ts:55`) only splits and trims, and `useReleaseWorkbench.ts:110` in stellar-ui lowercases in the **browser** for one of the two member write paths.

So `rock` and `Rock` are two rows today, and this ADR does not fix that. What it does fix is the curated set holding both, which is the one place the inconsistency is least excusable. Folding the member write paths as well needs a migration merging existing case-variant rows along with their `ReleaseTag` and `ArtistTag` children, and is its own issue.

## Consequences

- Curation is gated on `tags_manage`, the permission the alias routes already use, whose registry description already claims "related tag tooling". No new permission, so no install starts unable to curate.
- `GET /tags/official` is `requireAuth`, unlike every route on the alias router, which gates even its `GET`. A picker that only worked for staff would serve nobody.
- `GET /tags/official` is unpaginated. It is bounded by staff action rather than member activity, which is what makes that safe; `GET /tags` is the paginated read over the unbounded table.
- Promotion and demotion both write an audit row — `tag.promote` and `tag.demote`. The promote row carries the name as typed alongside the name it resolved to, which is the only record that a fold or an alias redirect happened.
- A fresh install has an empty curated set. Nothing seeds one, because promotion mints and a seeded genre list would presume what the site is about.
- Tag rows are never deleted in production — the only `deleteMany` is devTools cleanup, guarded to `seed.*` names — so an official tag persists until it is demoted.
  - _Superseded in part by [ADR-0047](0047-a-tag-name-has-one-canonical-form.md):_ its migration deletes the merged-away variants, carrying `isOfficial` to the survivor.
