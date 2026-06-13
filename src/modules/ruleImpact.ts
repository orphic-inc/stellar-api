/**
 * PRD-05 rule scoring — docs/prd/05-rules-and-governance.md (descent target #1).
 *
 * Pure function: given a rule/sub-rule outcome (adherence or violation) and the
 * actor's standing tier, return the Community Reputation Score (CRS) delta. No DB
 * — the weights live on the `Rule`/`SubRule` rows; this is the table-driven scorer
 * that reads them, mirroring the PRD-03 `scoreStylesheetSelection` slice.
 *
 * Magnitudes (the ×10 pristine reward, the repeat-offender "hammer", per-node
 * weights) are flagged TBD in PRD-05's open questions. The STRUCTURE is settled;
 * the constants are placeholders — change the tables here + the spec together.
 */

export type RuleOutcome = 'compliance' | 'violation';

/**
 * Standing tier — the PRD-05 backbone. Scales a rule's raw weight: good standing
 * amplifies rewards (pristine ×10, "the strongest positive"); bad standing
 * amplifies penalties ("the mighty hammer" — large, compounding negative, the
 * downside mirror of tiering). Computation of which tier a user is in is ADR-0004
 * (descent target #2) — this scorer just takes the tier as input.
 */
export type Standing = 'pristine' | 'clean' | 'neutral' | 'poor' | 'hammer';

/** The CRS-weight pair carried by any rule-tree node (`Rule` or `SubRule`). */
export interface RuleWeights {
  /** CRS reward when adhered to (>= 0). */
  complianceWeight: number;
  /** CRS penalty magnitude when breached (>= 0; negated below). */
  violationWeight: number;
}

export interface RuleImpactEvent {
  outcome: RuleOutcome;
  rule: RuleWeights;
  /** Optional sub-rule node; its weight composes ADDITIVELY on top of the parent. */
  subRule?: RuleWeights;
  /** Actor's standing tier; defaults to 'neutral' (×1, no amplification). */
  standing?: Standing;
}

export interface RuleImpact {
  /** Signed CRS delta: positive for compliance, negative for a violation. */
  crs: number;
  outcome: RuleOutcome;
  standing: Standing;
}

// Compliance rewards scale UP with good standing — pristine ×10 is the strongest
// positive; the long-term poor barely earn back. Magnitudes PRD-05 TBD.
const COMPLIANCE_MULTIPLIER: Record<Standing, number> = {
  pristine: 10,
  clean: 3,
  neutral: 1,
  poor: 0.5,
  hammer: 0.25
};

// Violation penalties scale UP with bad standing — the "mighty hammer": a clean
// record takes the face-value hit, the repeat offender takes ×10. Magnitudes TBD.
const VIOLATION_MULTIPLIER: Record<Standing, number> = {
  pristine: 1,
  clean: 1,
  neutral: 1,
  poor: 3,
  hammer: 10
};

export const ruleImpact = (event: RuleImpactEvent): RuleImpact => {
  const standing = event.standing ?? 'neutral';
  const compliance = event.outcome === 'compliance';

  // A sub-rule's weight composes additively with its parent rule's (PRD-05:
  // "each rule / SubRule has its own micro-impact on CRS").
  const base = compliance
    ? event.rule.complianceWeight + (event.subRule?.complianceWeight ?? 0)
    : event.rule.violationWeight + (event.subRule?.violationWeight ?? 0);

  const crs = compliance
    ? base * COMPLIANCE_MULTIPLIER[standing]
    : -(base * VIOLATION_MULTIPLIER[standing]);

  return { crs, outcome: event.outcome, standing };
};
