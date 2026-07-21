# PRD-05 — Rules & Governance

**Status:** Draft · **Owner:** @obrien-k · **Extends:** [PRD-01 Community-Score / CRS](01-Community-Score.md)
**Decisions:** [ADR-0001 granular permissions](../adr/0001-granular-permission-checks.md) (enforcement), [ADR-0002 community-health-pulse](../adr/0002-community-health-pulse.md) (standing trend), [ADR-0004 standing → CRS + warnings/bans](../adr/0004-standing-warnings-bans.md)
**Numbering:** PRD-01 Community-Score · PRD-02 IRC & Announce · PRD-03 Stylesheets · PRD-04 Contribution/Release/Music · **PRD-05 Rules & Governance** · PRD-06 Ratio · PRD-07 Donations · PRD-08 Collages & Cover Art · PRD-09 Golden-Rules Surfacing

> The wide opus. Governs behavior across the site and Communities, and is a backbone of the CRS. Rules are **composable and CRS-weighted**; this PRD defines the model, not the full rule prose. The canonical prose lives in two mirrors: the in-app `RulesPage` (rendered per-site with `${...}` placeholders) and the repo's [`CODE_OF_CONDUCT.md`](../../CODE_OF_CONDUCT.md) (the prose home). The 6-rule **model** stays here in the PRD.

## The Golden Rules (6 — canonical, site-wide, immutable)

Six canonical rules govern the whole site. They are **non-negotiable and baked into the software** — the seeded root of the rule tree; any per-Community rule may only ever be a **subset or extension** of these six. They are deliberately kept whole — not consolidated — and are the backbone of CRS standing. The canonical prose lives in [`CODE_OF_CONDUCT.md`](../../CODE_OF_CONDUCT.md) (mirrored into the `seedGoldenRules()` table by a CI drift-guard); the user-facing surfacing and `${...}` token resolution are **[PRD-09](09-golden-rules-surfacing.md)** / **[ADR-0020](../adr/0020-rules-tree-variable-resolution.md)**.

1. **Accounts** — one account per person per lifetime; no sharing/trading/selling; keep it active.
2. **Invites** — you are responsible for your invitees; no public trading/offering; do not request.
3. **Contribution Integrity & Accounting** — no manipulating the contribute/consume ledger; Contributions must be honest, with **live links + accurate metadata**; protect your credentials (account / API key). _(Content-tracker cast: a self-hosted host counts as a seedbox-class source; RSS/IRC announcements + idle/activity tracking stand in for a torrent announce.)_
4. **Conduct** — no blackmail/scams/impersonation; civil discourse; no backseat-moderation; **respect staff decisions** (staff are volunteers; their interpretation of the rules is final; raise disputes privately). _(Earlier drafts split "Respect Staff" into a 7th rule; it folds into Conduct, matching the prose's own grouping.)_
5. **Access & Automation** — no free VPN/Tor; automated access via the **API only** (rate-limited); no automated abuse of download credits.
6. **Bugs & Exploits** — don't seek or exploit live bugs (responsible disclosure); don't publish exploits.

## Composable rule model (the architecture)

Rules form a hierarchy, each node carrying a **CRS micro-impact**:

```
GoldenRule (site-wide, 1..6)
  └─ CommunityRules (per Community)
        ├─ may adopt 0, some, or all GoldenRules
        └─ may add its own rules, each with SubRules
              └─ each rule / SubRule has its own micro-impact on CRS
```

- A Community may have **no** rules, **adopt** GoldenRules, or define e.g. **5 rules with 2 SubRules each** — every node can carry its own compliance/violation CRS weight.
- This makes governance data-driven (a rule tree with weights), not hardcoded — superseding the legacy switch-style rule rendering. `RulesPage` / `ForumSpecificRule` are the current content homes.

## CRS standing (the backbone)

- **Pristine record → ×10** CRS (long-term clean standing is the strongest positive).
- **Poor standing → lower** CRS.
- **Long-term poor** (frequent warnings, ban evasion) → **the mighty hammer**: large, compounding negative (the downside mirror of tiering).
- Standing reads a **Warning/Ban governance model** — net-new (today only `User.warnedTimes`). Computation + model decided in **[ADR-0004](../adr/0004-standing-warnings-bans.md)**. Magnitudes (the ×10, the hammer curve, per-rule micro-impacts) are **TBD**.

## Sub-rulesets

| Ruleset            | Status                                                                                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GoldenRules**    | the 6 above (canonical, immutable — seeded from `CODE_OF_CONDUCT.md`, surfaced via PRD-09)                                                                                                         |
| **CommunityRules** | composable per-Community tree (above) — leans on `Community`, `UserRank`, `RulesPage`                                                                                                              |
| **StaffRules**     | staff conduct — wiki page `/wiki/staff-rules` (`${staff_rules_article}`), seeded here; enforcement is `StaffGroup`/`UserRank` + ADR-0001 permissions                                               |
| **InterviewRules** | recruitment/interview conduct — public wiki (korin.pink), `${interview_article}`; applicants have no account, so it cannot live behind the login                                                   |
| **ForumRules**     | forum conduct — wiki page `/wiki/forum-rules` (`${forum_rules_article}`), seeded here; enforcement is the class-gate system (`ForumSpecificRule` is a stub)                                        |
| **IRCRules**       | conduct on the IRC network — public wiki (korin.pink), `${irc_rules_article}`; **the IRC feature itself is PRD-02**. IRC is the intake funnel under invite-only registration, so it is pre-account |

## Bridges to existing decisions

- **ADR-0001** (granular permissions) is the **enforcement substrate** — rule gates name explicit permissions, no role bleed.
- **ADR-0002** (community-health pulse) feeds **standing trends** into CRS.
- **ADR-0004** (new) records the standing→CRS computation + the Warning/Ban model.

## Concept → code (descent map)

| Concept                                         | Lives in                                                                    |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| Forum + forum rules                             | `forum.ts`, `ForumSpecificRule`, `RulesPage`, `Thread` (built)              |
| Staff / ranks / reports                         | `staff.ts`, `staffInbox.ts`, `reports.ts`, `StaffGroup`, `UserRank` (built) |
| Permissions enforcement                         | ADR-0001 — `requirePermission` / `hasPermission`                            |
| Forum/Staff rule prose                          | `wikiFixtures.ts` + `prisma/seed-wiki/` (built, #126)                       |
| IRC / Interview rule prose                      | korin-pink public wiki (external)                                           |
| Warnings/Bans, Community rule-tree, CRS weights | **net-new** (CRS deferred post-v1)                                          |

## Red-green descent targets

1. ~~**Rule model** — a `Rule`/`SubRule` tree with a CRS-weight field + a pure `ruleImpact(...)` function (table-driven, mirroring the PRD-03 stylesheet slice).~~ **Shipped: [#123](https://github.com/orphic-inc/stellar-api/issues/123).** `Rule`/`SubRule` models (compliance/violation weights, `onDelete: Cascade`), the pure table-driven `ruleImpact()` (`src/modules/ruleImpact.ts` — standing-tier × per-node weights, magnitudes still TBD per the open questions below), and `GET /api/rules/tree`. The standing tier it consumes is computed by descent target #2 (ADR-0004).
2. ~~**Warning/Ban model** + standing computation (ADR-0004).~~ **Standing computation shipped: [#124](https://github.com/orphic-inc/stellar-api/issues/124).** Pure `computeStanding()` (`src/modules/standing.ts`) rolls active `UserWarning` rows (accrual + expiry) and ban state into the 5-tier `Standing` that `ruleImpact()` (#1) consumes; surfaced on the profile read path (`PublicProfile.standing`). Thresholds are ADR-0004 placeholders (TBD). The fuller Warning/Ban _entity_ model (suspensions, escalation ladder, ban-evasion linkage) remains for ADR-0004 to finalize — this slice computes standing over the existing `UserWarning` + `banDate`.
3. ~~**Document ForumRules/StaffRules** against the built code; spec IRCRules + InterviewRules as net-new.~~ **Shipped: [#126](https://github.com/orphic-inc/stellar-api/issues/126)**, on a corrected model — the sub-rulesets are **wiki pages the canon links to**, not tree nodes carrying CRS weights. Forum + Staff pages are seeded here (`wikiFixtures.ts`, prose under `prisma/seed-wiki/`); IRC + Interview are public-wiki pages owned by korin-pink, because the Interview gates registration and applicants have no account. The same slice fixed the canon's dead links: `${invite_article}`, `${classes_article}`, `${requests_article}` and `${interfaces_article}` had always resolved to `/wiki/...` routes nothing created, and `STELLAR_PUBLIC_KB_BASE` pointed at a domain that does not exist. See [governance/forum-and-staff-rules.md](../governance/forum-and-staff-rules.md).
4. ~~**Seed the GoldenRules + surface them**~~ — the 6-rule tree is seeded from `CODE_OF_CONDUCT.md` (`seedGoldenRules()`, drift-guarded), and `GET /api/rules/tree` ships the resolved `${...}` `variables` map for the UI. Spec: **[PRD-09](09-golden-rules-surfacing.md)** / **[ADR-0020](../adr/0020-rules-tree-variable-resolution.md)**.

## Open questions

> **CRS rule-scoring is deferred until post-v1** (2026-07-21). The magnitude questions below stay open but are not v1 work, and nothing should be built against them meanwhile. State on `main`: `ruleImpact()` has zero production callers, `warnUser()` takes a free-text reason with no rule reference, and every weight column defaults to `0`. Wiring it needs a warning→rule linkage that does not exist.

- CRS magnitudes: the ×10 pristine reward, the repeat-offender hammer curve, and per-rule/SubRule micro-impact values — TBD.
- Warning/Ban model shape (entities, escalation, ban-evasion detection) — ADR-0004.
- Do CommunityRules inherit GoldenRules by default, or opt-in per Community?
