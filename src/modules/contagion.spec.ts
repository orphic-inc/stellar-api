import {
  contagion,
  CONTAGION_FLOOR,
  CONTAGION_REVIEW_THRESHOLD
} from './contagion';

// ADR-0004 §3 / PRD-05 — invite-tree Contagion. Distances are hops UP to each
// infected (banned) ancestor; 1 = direct inviter. Decay halves per level over a
// reach of 4; base drag −1.0; cumulative, floored at −2.0; suspect ≤ −0.5.
describe('contagion', () => {
  it('scores a clean genealogy as 0 / not suspect', () => {
    expect(contagion([])).toEqual({ score: 0, suspect: false });
  });

  it('decays by distance — direct invitee penalised more than a grandchild', () => {
    expect(contagion([1]).score).toBeCloseTo(-1.0, 10);
    expect(contagion([2]).score).toBeCloseTo(-0.5, 10);
    expect(contagion([3]).score).toBeCloseTo(-0.25, 10);
    expect(contagion([4]).score).toBeCloseTo(-0.125, 10);
    // Strictly weaker each level down.
    expect(contagion([1]).score).toBeLessThan(contagion([2]).score);
    expect(contagion([2]).score).toBeLessThan(contagion([3]).score);
  });

  it('is out of reach past level 4', () => {
    expect(contagion([5])).toEqual({ score: 0, suspect: false });
    expect(contagion([6, 9])).toEqual({ score: 0, suspect: false });
  });

  it('compounds multiple infected ancestors cumulatively', () => {
    // direct inviter banned (−1.0) + banned grandparent (−0.5) = −1.5
    expect(contagion([1, 2]).score).toBeCloseTo(-1.5, 10);
  });

  it('clamps the worst case to the floor (suspect, not condemned)', () => {
    // −1.0 −1.0 −0.5 = −2.5 raw → clamped to −2.0
    expect(contagion([1, 1, 2]).score).toBeCloseTo(CONTAGION_FLOOR, 10);
    expect(contagion([1, 1, 1, 1]).score).toBe(CONTAGION_FLOOR);
  });

  it('flags suspect at or below the review threshold', () => {
    expect(contagion([1]).suspect).toBe(true); // −1.0 ≤ −0.5
    expect(contagion([2]).suspect).toBe(true); // −0.5 ≤ −0.5 (boundary)
    expect(contagion([3]).suspect).toBe(false); // −0.25 > −0.5
    // A lone distant ancestor isn't suspect, but two stack into it.
    expect(contagion([3, 3]).suspect).toBe(true); // −0.5
    expect(CONTAGION_REVIEW_THRESHOLD).toBe(-0.5);
  });
});
