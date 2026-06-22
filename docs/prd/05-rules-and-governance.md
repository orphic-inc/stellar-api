# PRD-05 — Rules & Governance

**Status:** Draft · **Owner:** @obrien-k · **Extends:** [PRD-01 Community-Score / CRS](01-Community-Score.md)
**Decisions:** [ADR-0001 granular permissions](../adr/0001-granular-permission-checks.md) (enforcement), [ADR-0002 community-health-pulse](../adr/0002-community-health-pulse.md) (standing trend), [ADR-0004 standing → CRS + warnings/bans](../adr/0004-standing-warnings-bans.md)
**Numbering:** PRD-01 Community-Score · PRD-02 IRC & Announce · PRD-03 Stylesheets · PRD-04 Contribution/Release/Music · **PRD-05 Rules & Governance** · PRD-06 Ratio · PRD-07 Donations · PRD-08 Collages & Cover Art

> The wide opus. Governs behavior across the site and Communities, and is a backbone of the CRS. Rules are **composable and CRS-weighted**; this PRD defines the model, not the full rule prose. The canonical prose lives in two mirrors: the in-app `RulesPage` (rendered per-site with `${...}` placeholders) and the repo's [`CODE_OF_CONDUCT.md`](../../CODE_OF_CONDUCT.md) (the prose home). The 7-rule **model** stays here in the PRD.

## The Golden Rules (7 — canonical, site-wide)

Seven canonical rules govern the whole site. They are deliberately kept whole — not consolidated — and are the backbone of CRS standing:

1. **Accounts** — one account per person per lifetime; no sharing/trading/selling; keep it active.
2. **Invites** — you are responsible for your invitees; no public trading/offering; do not request.
3. **Contribution Integrity & Accounting** — no manipulating the contribute/consume ledger; Contributions must be honest, with **live links + accurate metadata**; protect your credentials (account / API key). _(Content-tracker cast: a self-hosted host counts as a seedbox-class source; RSS/IRC announcements + idle/activity tracking stand in for a torrent announce.)_
4. **Conduct** — no blackmail/scams/impersonation; civil discourse; no backseat-moderation.
5. **Access & Automation** — no free VPN/Tor; automated access via the **API only** (rate-limited); no automated abuse of download credits.
6. **Bugs & Exploits** — don't seek or exploit live bugs (responsible disclosure); don't publish exploits.
7. **Respect Staff** — staff are volunteers; their interpretation of the rules is final; raise disputes privately.

## Composable rule model (the architecture)

Rules form a hierarchy, each node carrying a **CRS micro-impact**:

```
GoldenRule (site-wide, 1..7)
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
| **GoldenRules**    | the 7 above (canonical)                                                                                                                                                                            |
| **CommunityRules** | composable per-Community tree (above) — leans on `Community`, `UserRank`, `RulesPage`                                                                                                              |
| **StaffRules**     | staff conduct + the +50 CRS/week-served signal (cross-ref PRD-01) — `StaffGroup`, `UserRank` — [documented as built](../governance/forum-and-staff-rules.md#staffrules-built)                      |
| **InterviewRules** | recruitment/interview conduct — net-new                                                                                                                                                            |
| **ForumRules**     | governance for the **already-built** forum (class-gates + `RulesPage` + rule tree; `ForumSpecificRule` is a stub) — [documented as built](../governance/forum-and-staff-rules.md#forumrules-built) |
| **IRCRules**       | conduct on the IRC network — **rules here; the IRC feature itself is PRD-02**                                                                                                                      |

## Bridges to existing decisions

- **ADR-0001** (granular permissions) is the **enforcement substrate** — rule gates name explicit permissions, no role bleed.
- **ADR-0002** (community-health pulse) feeds **standing trends** into CRS.
- **ADR-0004** (new) records the standing→CRS computation + the Warning/Ban model.

## Concept → code (descent map)

| Concept                                                    | Lives in                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| Forum + forum rules                                        | `forum.ts`, `ForumSpecificRule`, `RulesPage`, `Thread` (built)              |
| Staff / ranks / reports                                    | `staff.ts`, `staffInbox.ts`, `reports.ts`, `StaffGroup`, `UserRank` (built) |
| Permissions enforcement                                    | ADR-0001 — `requirePermission` / `hasPermission`                            |
| Warnings/Bans, IRC rules, Community rule-tree, CRS weights | **net-new**                                                                 |

## Red-green descent targets

1. ~~**Rule model** — a `Rule`/`SubRule` tree with a CRS-weight field + a pure `ruleImpact(...)` function (table-driven, mirroring the PRD-03 stylesheet slice).~~ **Shipped: [#123](https://github.com/orphic-inc/stellar-api/issues/123).** `Rule`/`SubRule` models (compliance/violation weights, `onDelete: Cascade`), the pure table-driven `ruleImpact()` (`src/modules/ruleImpact.ts` — standing-tier × per-node weights, magnitudes still TBD per the open questions below), and `GET /api/rules/tree`. The standing tier it consumes is computed by descent target #2 (ADR-0004).
2. ~~**Warning/Ban model** + standing computation (ADR-0004).~~ **Standing computation shipped: [#124](https://github.com/orphic-inc/stellar-api/issues/124).** Pure `computeStanding()` (`src/modules/standing.ts`) rolls active `UserWarning` rows (accrual + expiry) and ban state into the 5-tier `Standing` that `ruleImpact()` (#1) consumes; surfaced on the profile read path (`PublicProfile.standing`). Thresholds are ADR-0004 placeholders (TBD). The fuller Warning/Ban _entity_ model (suspensions, escalation ladder, ban-evasion linkage) remains for ADR-0004 to finalize — this slice computes standing over the existing `UserWarning` + `banDate`.
3. **Document ForumRules/StaffRules** against the built code; spec IRCRules + InterviewRules as net-new. **Documentation half shipped: [#126](https://github.com/orphic-inc/stellar-api/issues/126)** — ForumRules + StaffRules documented as built in [governance/forum-and-staff-rules.md](../governance/forum-and-staff-rules.md) (sub-rule list, the `ruleImpact()` weights as implemented, and an honest built-vs-stub map: `ForumSpecificRule` is a stub, the staff "+50 CRS/week-served" signal is not yet a CRS dimension). The IRCRules + InterviewRules specs remain net-new (HITL — content + weights need product decisions).

## Open questions

- CRS magnitudes: the ×10 pristine reward, the repeat-offender hammer curve, and per-rule/SubRule micro-impact values — TBD.
- Warning/Ban model shape (entities, escalation, ban-evasion detection) — ADR-0004.
- Do CommunityRules inherit GoldenRules by default, or opt-in per Community?
