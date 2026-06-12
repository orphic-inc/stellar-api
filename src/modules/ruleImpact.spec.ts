import { ruleImpact } from './ruleImpact';

// PRD-05 rule scoring (docs/prd/05-rules-and-governance.md, descent target #1).
// Pure: signed CRS delta from a rule/sub-rule outcome + standing tier. Magnitudes
// are PRD-05 TBD (compliance ×{pristine10,clean3,neutral1,poor.5,hammer.25};
// violation ×{neutral1,poor3,hammer10}); change the tables + this spec together.

describe('ruleImpact', () => {
  it('rewards adherence at face value for a neutral-standing actor', () => {
    const r = ruleImpact({
      outcome: 'compliance',
      rule: { complianceWeight: 2, violationWeight: 5 }
    });
    expect(r.crs).toBeCloseTo(2, 10); // 2 × neutral(1)
    expect(r.outcome).toBe('compliance');
    expect(r.standing).toBe('neutral'); // defaulted
  });

  it('penalizes a violation as a NEGATIVE delta from the violation weight', () => {
    const r = ruleImpact({
      outcome: 'violation',
      rule: { complianceWeight: 2, violationWeight: 5 }
    });
    expect(r.crs).toBeCloseTo(-5, 10); // -(5 × neutral(1))
    expect(r.outcome).toBe('violation');
  });

  it('amplifies adherence ×10 for a pristine record (the strongest positive)', () => {
    const r = ruleImpact({
      outcome: 'compliance',
      rule: { complianceWeight: 2, violationWeight: 5 },
      standing: 'pristine'
    });
    expect(r.crs).toBeCloseTo(20, 10); // 2 × 10
  });

  it('shrinks the adherence reward for poor standing', () => {
    const r = ruleImpact({
      outcome: 'compliance',
      rule: { complianceWeight: 2, violationWeight: 5 },
      standing: 'poor'
    });
    expect(r.crs).toBeCloseTo(1, 10); // 2 × 0.5
  });

  it('brings the mighty hammer ×10 down on a repeat offender’s violation', () => {
    const r = ruleImpact({
      outcome: 'violation',
      rule: { complianceWeight: 2, violationWeight: 5 },
      standing: 'hammer'
    });
    expect(r.crs).toBeCloseTo(-50, 10); // -(5 × 10)
  });

  it('does NOT amplify a pristine actor’s violation (face-value hit)', () => {
    const r = ruleImpact({
      outcome: 'violation',
      rule: { complianceWeight: 2, violationWeight: 5 },
      standing: 'pristine'
    });
    expect(r.crs).toBeCloseTo(-5, 10); // -(5 × 1) — pristine doesn't soften the breach
  });

  it('composes a sub-rule weight additively on top of the parent rule', () => {
    const r = ruleImpact({
      outcome: 'compliance',
      rule: { complianceWeight: 2, violationWeight: 5 },
      subRule: { complianceWeight: 1.5, violationWeight: 3 }
    });
    expect(r.crs).toBeCloseTo(3.5, 10); // (2 + 1.5) × neutral(1)
  });

  it('composes sub-rule violation weight then amplifies by standing', () => {
    const r = ruleImpact({
      outcome: 'violation',
      rule: { complianceWeight: 2, violationWeight: 5 },
      subRule: { complianceWeight: 1.5, violationWeight: 3 },
      standing: 'poor'
    });
    expect(r.crs).toBeCloseTo(-24, 10); // -((5 + 3) × 3)
  });

  it('returns a zero delta for a zero-weighted node (documentation-only rule)', () => {
    const r = ruleImpact({
      outcome: 'violation',
      rule: { complianceWeight: 0, violationWeight: 0 },
      standing: 'hammer'
    });
    expect(r.crs).toBeCloseTo(0, 10); // -(0 × 10) — no impact regardless of standing
  });
});
