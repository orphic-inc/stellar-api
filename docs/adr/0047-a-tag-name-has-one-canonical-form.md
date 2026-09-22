# A tag name has one canonical form

**Status: Accepted (2026-09-22).** Accepted as the gate on [#689](https://github.com/orphic-inc/stellar-api/issues/689), filed out of [#298](https://github.com/orphic-inc/stellar-api/issues/298)'s grill. Supersedes [ADR-0045](0045-official-tags-annotate-an-open-vocabulary.md) §5, which recorded that names were folded on the promote path only. The grill's ten decisions are on the issue; this records them and why.

## Context

`Tag.name` is a case-sensitive `@unique` string, so `rock`, `Rock` and `ROCK` were three rows with three `occurrences` counts. [ADR-0045](0045-official-tags-annotate-an-open-vocabulary.md) made the gap matter: `isOfficial` marks `rock` canonical, and a member typing `Rock` got a different row that no picker matched, no alias redirected and the curated vocabulary could not see.

**The write paths disagreed, and the issue understated how.** The contribution path split, trimmed and deduped, with no fold. The workbench path folded twice: in stellar-ui's browser (`useReleaseWorkbench.ts:110`) and again in `releaseTagSchema`'s Zod transform. Promotion folded in `foldTagName`. The dev-tools generator minted directly. Case was the visible symptom; separators were the same bug. `hip hop`, `hip-hop` and `hip.hop` split one tag exactly as `Rock` and `rock` did.

**The read side had no rule at all.** Release and artist search matched the name as typed, with no fold and no alias. The top-10 exclusion folded case only. Once writes normalize, a reader that does not will miss every stored name.

**The legacy implementation normalizes every tag write the same way.** `Misc::sanitize_tag` lowercases, deletes everything outside `[a-z0-9.]`, and trims edge separators. Upload, add-tag, the official-tags manager, collages, requests and the tag tools all call it. Its merge tool (`tools/misc/tags.php`) handles a torrent carrying both the old tag and its replacement by deleting the old row outright.

**Measured before deciding:** Kai's dev database held 64 tags, none with an uppercase letter or a character outside `[a-z0-9.]`, and no aliases. The dot is already the house separator: the dev-tools pools use `hip.hop`, and so do the existing alias tests.

## Decision

### 1. The rule

1. Lowercase ASCII.
2. Turn every run of spaces, tabs, `-` and `_` into one `.`.
3. Drop anything outside `[a-z0-9.]`.
4. Collapse repeated dots, and trim dots from both ends.

`Hip Hop`, `hip-hop` and `hip_hop` are all `hip.hop`; `Drum & Bass` is `drum.bass`.

That is the legacy character set, with one change: **a separator becomes a dot rather than being deleted.** Deleting it made `hiphop` and `drumbass`, which read worse and collide more. Stripping to the character set, not only folding case, is what makes "one spelling finds one tag" true for separators as well as case.

**ASCII only, on purpose.** A full Unicode lowercase maps some non-ASCII letters onto ASCII ones: the Kelvin sign becomes `k`, and the dotted capital I becomes `i` plus a combining mark. Postgres' `lower()` follows the database locale. The migration restates this rule in SQL (§7), and the two agree only if neither depends on where it runs. Non-ASCII letters are dropped, as the legacy rule drops them.

### 2. It runs inside the resolver

`normalizeTagName` lives in `modules/tag.ts`, and `resolveTagName` / `resolveTagNames` apply it before the alias lookup. So "resolve" means normalize, then follow the alias. Every existing caller picks the rule up for free: the contribution path, workbench add, the release tag route, promotion and the feed filter. A future path cannot skip the rule without also skipping aliases. `foldTagName` and the Zod transform are removed so the rule lives in one place. The dev-tools generator mints without resolving, so it calls `normalizeTagName` itself.

The alternatives were a separate call at each site, which is the shape that let one path forget, or a transform on every schema, which misses module-level callers such as the feed.

### 3. An empty result is dropped from a list and refused on its own

A name can normalize to nothing: `&&&`, `---`, `♫`. `resolveTagNames` drops it, as blanks were already dropped from a comma-separated list. A single-name write — workbench add, promotion, either alias write — answers `400 { msg: 'Tag name has no usable characters' }`. A single add that silently did nothing would look like a bug, and failing a whole contribution over one junk item would be harsh. The refusal sits in the module and not the resolver, because the feed calls the resolver and must answer an empty feed rather than an error.

### 4. Which merged row survives

Variants are the rows sharing a normalized name. **The survivor is the row already carrying the canonical name**, else an official row, else the lowest id. `isOfficial` is ORed across the group. The first choice is nearly forced: renaming another row onto that name would collide with it on `@unique`. The second keeps a curated tag's id stable, which matters because demotion is addressed by id.

**`occurrences` is recounted from `release_tags`, not summed.** It counts the releases carrying a tag, so summing would double-count every release that carried two variants. **`ReleaseHistory` snapshots are not touched.** They record the `tagIds` and `tagNames` true at the time, and rewriting them would falsify history.

### 5. Two variants on one release keep one row

`ReleaseTag` and `ArtistTag` are unique on `(owner, tagId)`, so a release carrying two variants cannot keep both. It keeps the row on the best-ranked variant, by the same ordering as §4, and the other row is deleted along with its `ReleaseTagVote` rows. This is the legacy rule. Merging votes was rejected because the counters cannot be rebuilt from vote rows. They are seeded at +1/−1, an up-vote adds 2 and a down-vote adds 1, and restating that convention in SQL is the drift `modules/releaseTags.ts` exists to prevent. No history rows are written: the merge is a data repair, not a member action.

### 6. Aliases are normalized too

The resolver looks `badTag` up normalized, so an unnormalized alias would not match anything. The migration normalizes every `badTag` and repoints aliases on merged-away tags to the survivor. It first removes the aliases that cannot survive normalization, reporting each with `RAISE NOTICE`:

- **no usable characters** — nothing can match them;
- **onto their own target** — normalization now does their job;
- **onto an official tag** other than their target — the ADR-0045 §3 guard would have refused them, and curation stands;
- **a collision**, two aliases normalizing alike — the older one stands. The first curator's decision wins, and the notice makes each drop visible. Failing the migration would block a release over something an admin fixes in seconds.

Both alias writes now go through `prepareTagAlias`, which applies the same rules, so the route cannot recreate what the migration removed.

### 7. The migration restates the rule in SQL, and a test holds them together

`20260922120000_normalize_tag_names` is one `DO` block, so it runs as one transaction and deploys through `prisma migrate deploy` like every other data repair. The normalizing expression appears once, between `/* normalize:begin */` and `/* normalize:end */` markers. `tagNameMigration.integration.ts` cuts that expression out of the migration file and runs it against `normalizeTagName` over 30 fixtures chosen for where SQL and JavaScript could part ways. The test runs the migration's own copy, not a restatement of it.

A migration is frozen once applied, so it only has to agree with the TypeScript rule at the moment it runs. If the rule changes later, the parity test goes red. That is the right signal, because a changed rule needs a new migration for the rows the old one wrote.

A tag whose own name normalizes to nothing is left in place. No write can reach it again, and deleting it would take its releases' tagging with it.

### 8. Reads resolve exactly as writes do

Release search, artist search and the top-10 exclusion run their names through `resolveTagNames`. So a search for `Hip Hop`, `hip-hop` or an aliased `hiphop` finds `hip.hop`. Following aliases on reads is what makes an alias worth creating: every existing release is stored under the good tag, so a search that ignores aliases fails for exactly the spellings an admin bothered to alias.

A search filter whose every name normalizes away **matches nothing**, not everything. Under `tagMode=all` an empty `AND` would have matched every row, so that mode falls back to the `in: []` form.

## Consequences

- A member's typed tag can come back spelled differently. The API already returns the stored name, and the release tag route finds the created tag by its resolved name.
- Workbench add, promotion and both alias writes can answer a `{ msg }` 400. Each operation now registers a `MsgResponse` 400, which also describes the validation body, since that body carries `msg` as well.
- stellar-ui's browser fold is redundant and is removed in [ui#369](https://github.com/orphic-inc/stellar-ui/issues/369). It is harmless either way, so neither side blocks the other.
- The migration deletes `Tag` rows: the merged-away variants. ADR-0045's closing note, that production deletes no tag rows, no longer holds.
- `Collage.tags` and `Post.tags` are free `String[]` columns, not `Tag` rows, so this rule does not reach them. The legacy implementation sanitizes collage tags too; whether to do the same is a separate decision about a separate feature.
- The rule is lossy for non-Latin tags. A name written entirely in another script normalizes to nothing and is refused. That is the legacy behaviour, and it is the price of an ASCII rule that SQL and JavaScript agree on everywhere.
