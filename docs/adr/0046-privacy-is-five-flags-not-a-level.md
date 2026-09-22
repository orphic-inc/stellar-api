# Privacy is five flags, not a level

**Status: Accepted (2026-09-22).** Accepted as the gate on [#586](https://github.com/orphic-inc/stellar-api/issues/586), which was filed as a decision rather than a defect and sat `ready-for-human` blocking two other issues. It removes the `paranoia` level from the schema, from both write doors and from the contract. Supersedes the level described in [#400](https://github.com/orphic-inc/stellar-api/issues/400)'s exclusion note, which stays correct in substance — see §5.

## Context

`UserSettings` carried a `paranoia` level (0–3) **and** five independent booleans — `showEmail`, `showLastSeen`, `showContributedStats`, `showConsumedStats`, `showRatioStats`. Nothing defined what happened when both were set, and the two endpoints that write the row each invented a different answer.

**The load-bearing fact: no gate ever read the level.** Every visibility decision in the codebase reads the five booleans — `modules/profile.ts` on a profile read, `modules/statsHistory.ts` for the stat time-series, `modules/top10.ts` for ranked-list eligibility, `modules/user.ts` for the invite-tree rollup. The stored number was inert. The booleans were the state; the level was a preset that had either already been applied, or had not.

**The two doors disagreed.** `PUT /profile/me` spread `paranoiaToVisibility(level)` **last** in the Prisma `data` object, so later keys won and any explicitly-submitted `show*` value was overwritten on every request carrying a level at all — not only when it changed. `PUT /users/settings` wrote the level bare with no cascade. The same body sent to the two doors produced two different rows.

**No member-facing defect existed**, and that is why this is recorded rather than fixed quietly. `/profile/me` worked: setting level 3 through the settings form wrote the three `false` values and the gates then hid all three. The clobber was latent because there was no `show*` control to clobber. `/users/settings` has no stellar-ui caller at all, so its arm was unreachable without a direct API client.

**What was real is that it blocked work.** stellar-ui could not wire the five settings as writable controls, because the write path would make them inert the moment they appeared. [ui#311](https://github.com/orphic-inc/stellar-ui/issues/311) closed having deferred them for exactly that reason.

### What the legacy implementation does, which reframed the options

The issue offered two options: the level is the only control, or the level is a preset over independently-editable flags. The legacy implementation takes a third position that neither describes.

**It stores no level at all.** `users_info.Paranoia` is a serialized **array of property names** — a deny list — and `check_paranoia($Property, $Paranoia, …)` tests membership. The save path builds that array **entirely from the submitted checkboxes** and serializes it; no level is submitted and none is stored.

**The presets are buttons.** `ParanoiaResetOff` ("Show everything"), `ParanoiaResetStats` ("Show stats only") and `ParanoiaResetOn` ("Show nothing") are client-side JavaScript that tick checkboxes. **Nothing records which one was clicked.**

That dissolves the question the issue was trying to answer. There is no "what does a stored level mean once the flags diverge from it", because no level is stored.

## Decision

### 1. The five booleans are the only privacy state

They already were — nothing read the level. This records the fact rather than changing behaviour.

### 2. `UserSettings.paranoia` is dropped

The column is removed by migration. It leaves the request schemas on both doors, and it leaves the `UserSettings` response schema.

### 3. No backfill, and this is the deliberate part

A stored level that disagrees with a row's flags **was never in effect**, because nothing read it. Applying it now would retroactively change what other members can see of someone, on the strength of a preference the system had already ignored. That is a new product decision wearing a migration's clothes.

The affected population is rows written through `PUT /users/settings`, which has no stellar-ui caller — direct API clients only.

### 4. Presets live in stellar-ui and leave no server-side trace

`paranoiaToVisibility` is deleted. The preset buttons become a ui affordance over the five checkboxes, as in the legacy settings page. The api has no paranoia logic at all.

This is why the level is not kept as a write-only convenience or as a derived read. Both were considered and both reduce to a field with no consumer once ui posts flags directly — the pattern this codebase keeps finding and removing.

### 5. `showMatureContent` is untouched and is not one of the five

It was always excluded from the cascade (#400): paranoia governs what **others** see of you, the mature gate governs what **you** see. Raising a privacy level must not silently change a member's own content preferences. That exclusion note survives this ADR; only the mechanism it was excluded from is gone.

## Consequences

- **This is a breaking contract change.** `paranoia` is removed from the `UserSettings` response schema, not merely widened. stellar-ui must land its half before or with the api release, and per ADR-0004 there it ties to the vendored `major.minor` — so this arc rolls the **minor** rather than the patch.
- **The two doors can no longer disagree**, by deletion rather than by a shared rule. Both now write only the five booleans, which they already both did.
- **The five controls become shippable.** An explicitly-sent flag reaches the writer because nothing overwrites it. That is the unblock ui#311 was waiting for.
- **`settingsParity.spec.ts` stands against reintroduction.** Two tests: neither door accepts `paranoia`, and all five flags reach both doors. A level added back as an input is what would make the checkboxes inert again, so the guard is on the input rather than on the name.
- A member loses the level summary in the settings UI. There is no "Current: Level 2" to show, because there is no level — which is also true of the legacy page this now matches.
