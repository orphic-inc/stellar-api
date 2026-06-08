# Standing → CRS, and the Warning/Ban model

**Status: Proposed — decision pending.** Serves [PRD-05 Rules & Governance](../prd/05-rules-and-governance.md); the CRS backbone in [PRD-01](../prd/01-Community-Score.md).

Rule compliance must move a user's Community Reputation Score: pristine standing rewards ×10, and long-term poor standing (frequent warnings, ban evasion) draws a large compounding penalty — "the mighty hammer." Today the only datum is `User.warnedTimes`; there is no Warning/Ban entity, no escalation ladder, and no ban-evasion linkage.

Decision to record here (not yet finalized):

- **Warning/Ban model** — entities for warnings, suspensions, bans; escalation ladder; association to the GoldenRule/CommunityRule violated; ban-evasion linkage (invite-tree + account signals).
- **Standing → CRS computation** — how rule micro-impacts + warning history compose into the standing multiplier (the ×10 pristine reward and the repeat-offender hammer curve), and whether it is computed-on-read (mirroring the ADR-0002 pulse) or event-logged.
- **Magnitudes** — the ×10, the hammer curve, and per-rule/SubRule micro-impact weights are TBD.

Enforcement remains [ADR-0001](0001-granular-permission-checks.md) (granular permissions); standing trend input comes from [ADR-0002](0002-community-health-pulse.md) (the pulse).

_Fill in the chosen model + computation + consequences once decided._
