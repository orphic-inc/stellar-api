import { scoreStylesheetSelection } from './stylesheetScore';

// PRD-03 stylesheet scoring (docs/prd/03-stylesheet-themes-and-scoring.md).
// Pure: CRS deltas for {user, site, author} from a selection event.
// USER_BASE = 0.1, SITE_BASE = 0.1415926535. Weights are PRD interpretation
// pending confirmation (see flags in PRD-03); change constants + this spec together.
const SITE_BASE = 0.1415926535;

describe('scoreStylesheetSelection', () => {
  it('credits the site its base CRS when a user picks the default theme', () => {
    const a = scoreStylesheetSelection({
      userId: 1,
      origin: { kind: 'site', isDefault: true }
    });
    expect(a.user).toBeCloseTo(0.1, 10); // USER_BASE x1
    expect(a.site).toBeCloseTo(SITE_BASE, 10); // SITE_BASE x1
    expect(a.author).toBeNull();
  });

  it('doubles the user reward for a non-default site theme', () => {
    const a = scoreStylesheetSelection({
      userId: 1,
      origin: { kind: 'site', isDefault: false }
    });
    expect(a.user).toBeCloseTo(0.2, 10); // USER_BASE x2
    expect(a.site).toBeCloseTo(SITE_BASE, 10);
    expect(a.author).toBeNull();
  });

  it('routes the x3 site bonus to the staff author when adopting a staff stylesheet', () => {
    const a = scoreStylesheetSelection({
      userId: 1,
      origin: { kind: 'staff', authorId: 42 }
    });
    expect(a.user).toBeCloseTo(0.3, 10); // USER_BASE x3
    expect(a.site).toBe(0); // routed away from the site
    expect(a.author).toEqual({ userId: 42, delta: SITE_BASE * 3 });
  });

  it('credits the site x5 for a self-set external stylesheet (no author entity)', () => {
    const a = scoreStylesheetSelection({
      userId: 1,
      origin: { kind: 'external' }
    });
    expect(a.user).toBeCloseTo(0.3, 10); // USER_BASE x3
    expect(a.site).toBeCloseTo(SITE_BASE * 5, 10); // FLAG: external x5 -> site (no author)
    expect(a.author).toBeNull();
  });

  it('pays the author the x5 bonus when another user adopts their stylesheet', () => {
    const a = scoreStylesheetSelection({
      userId: 1,
      origin: { kind: 'author', authorId: 7 }
    });
    expect(a.user).toBeCloseTo(0.3, 10); // adopter: USER_BASE x3
    expect(a.site).toBe(0);
    expect(a.author).toEqual({ userId: 7, delta: SITE_BASE * 5 });
  });

  it('gives the x5 user reward but no author bonus when using your own stylesheet', () => {
    // FLAG: self-selection is not an "adoption" — author bonus only fires for
    // OTHER users adopting, so self-use pays the user reward only (anti-farm).
    const a = scoreStylesheetSelection({
      userId: 7,
      origin: { kind: 'author', authorId: 7 }
    });
    expect(a.user).toBeCloseTo(0.5, 10); // USER_BASE x5
    expect(a.site).toBe(0);
    expect(a.author).toBeNull();
  });
});
