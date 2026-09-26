import {
  activeWarnedAt,
  activeWarnedUntil,
  computeStanding,
  isWarningActive
} from './standing';

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

// #719 — the warning sign and its expiry read only active warnings.
describe('activeWarnedAt', () => {
  const issued = (iso: string) => new Date(iso);

  it('is null with no warnings', () => {
    expect(activeWarnedAt([], NOW)).toBeNull();
  });
  it('is null once every warning has expired', () => {
    expect(
      activeWarnedAt(
        [{ createdAt: issued('2025-12-01T00:00:00Z'), expiresAt: past() }],
        NOW
      )
    ).toBeNull();
  });
  it('is the latest issue date among ACTIVE warnings only', () => {
    expect(
      activeWarnedAt(
        [
          { createdAt: issued('2026-02-01T00:00:00Z'), expiresAt: null },
          { createdAt: issued('2026-03-01T00:00:00Z'), expiresAt: future() },
          // Issued last, but expired — must not date the sign.
          { createdAt: issued('2026-06-01T00:00:00Z'), expiresAt: past() }
        ],
        NOW
      )
    ).toEqual(issued('2026-03-01T00:00:00Z'));
  });
});

describe('activeWarnedUntil', () => {
  it('is null with no active warning', () => {
    expect(activeWarnedUntil([{ expiresAt: past() }], NOW)).toBeNull();
  });
  it('is null while a permanent warning is active', () => {
    expect(
      activeWarnedUntil([{ expiresAt: future() }, { expiresAt: null }], NOW)
    ).toBeNull();
  });
  it('is the latest expiry among active warnings', () => {
    const later = new Date('2027-03-01T00:00:00Z');
    expect(
      activeWarnedUntil(
        [{ expiresAt: future() }, { expiresAt: later }, { expiresAt: past() }],
        NOW
      )
    ).toEqual(later);
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
