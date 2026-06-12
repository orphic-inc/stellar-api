import { computeStanding, isWarningActive } from './standing';

// PRD-05 #2 / ADR-0004 — pure standing computation over UserWarning + ban state.
// Ladder is settled; thresholds (POOR_AT=2, HAMMER_AT=4, PRISTINE_TENURE=365d)
// are ADR-0004 TBD placeholders — change the constants + this spec together.

const NOW = new Date('2026-06-12T00:00:00Z');
const future = () => new Date('2026-12-31T00:00:00Z');
const past = () => new Date('2026-01-01T00:00:00Z');

describe('isWarningActive', () => {
  it('treats a permanent (null-expiry) warning as always active', () => {
    expect(isWarningActive({ expiresAt: null }, NOW)).toBe(true);
  });
  it('treats a future-expiry warning as active', () => {
    expect(isWarningActive({ expiresAt: future() }, NOW)).toBe(true);
  });
  it('treats a past-expiry warning as inactive', () => {
    expect(isWarningActive({ expiresAt: past() }, NOW)).toBe(false);
  });
});

describe('computeStanding', () => {
  it('is pristine for a long-tenured account with zero active warnings', () => {
    const s = computeStanding({
      warnings: [],
      banned: false,
      now: NOW,
      accountAgeDays: 400
    });
    expect(s).toBe('pristine');
  });

  it('is merely clean for a fresh account with zero warnings', () => {
    const s = computeStanding({
      warnings: [],
      banned: false,
      now: NOW,
      accountAgeDays: 30
    });
    expect(s).toBe('clean');
  });

  it('accrues to neutral on a single active warning', () => {
    const s = computeStanding({
      warnings: [{ expiresAt: null }],
      banned: false,
      now: NOW,
      accountAgeDays: 400
    });
    expect(s).toBe('neutral'); // one warning sinks even a long-tenured account
  });

  it('accrues to poor at two active warnings', () => {
    const s = computeStanding({
      warnings: [{ expiresAt: null }, { expiresAt: future() }],
      banned: false,
      now: NOW
    });
    expect(s).toBe('poor');
  });

  it('brings the hammer at four active warnings (frequent offender)', () => {
    const s = computeStanding({
      warnings: [
        { expiresAt: null },
        { expiresAt: null },
        { expiresAt: future() },
        { expiresAt: null }
      ],
      banned: false,
      now: NOW
    });
    expect(s).toBe('hammer');
  });

  it('ignores expired warnings when accruing (expiry recovery)', () => {
    // three warnings, but two already expired → only one active → neutral, not hammer
    const s = computeStanding({
      warnings: [
        { expiresAt: past() },
        { expiresAt: past() },
        { expiresAt: future() }
      ],
      banned: false,
      now: NOW,
      accountAgeDays: 400
    });
    expect(s).toBe('neutral');
  });

  it('drops back to pristine once every warning has expired', () => {
    const s = computeStanding({
      warnings: [{ expiresAt: past() }, { expiresAt: past() }],
      banned: false,
      now: NOW,
      accountAgeDays: 400
    });
    expect(s).toBe('pristine');
  });

  it('is the hammer when banned, regardless of warning count', () => {
    const s = computeStanding({
      warnings: [],
      banned: true,
      now: NOW,
      accountAgeDays: 400
    });
    expect(s).toBe('hammer');
  });

  it('is the hammer on ban-evasion even when not currently banned', () => {
    const s = computeStanding({
      warnings: [],
      banned: false,
      banEvasion: true,
      now: NOW,
      accountAgeDays: 400
    });
    expect(s).toBe('hammer');
  });
});
