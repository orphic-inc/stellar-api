/**
 * Table-driven tests for the pure invite-handout evaluator (#282, ADR-0039).
 *
 * No DB mock: the module has no I/O, which is the point of the split. Every
 * rule the sweep relies on is pinned here, including the three that are easy to
 * regress into something that looks equivalent — no back-pay, a clamped period
 * being spent rather than banked, and the tenure floor outranking rank config.
 */
import {
  evaluateInviteGrant,
  isStandingDenied,
  grantClockOrigin,
  InviteGrantInput,
  MIN_TENURE_DAYS,
  PERIOD_DAYS,
  STAFF_LEVEL,
  DAY_MS
} from './inviteGrant';
import type { Standing } from './standing';

const NOW = new Date('2026-09-11T12:00:00.000Z');
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * DAY_MS);

const base = (over: Partial<InviteGrantInput> = {}): InviteGrantInput => ({
  perPeriod: 2,
  cap: 6,
  balance: 0,
  lastInviteGrantAt: daysAgo(PERIOD_DAYS),
  dateRegistered: daysAgo(365),
  standing: 'clean',
  disabled: false,
  rankLevel: 150,
  ...over
});

describe('evaluateInviteGrant — exemptions', () => {
  it('skips a disabled member', () => {
    const d = evaluateInviteGrant(base({ disabled: true }), NOW);
    expect(d.action).toBe('none');
    expect(d.reason).toBe('disabled');
  });

  it('skips staff, who create accounts directly', () => {
    const d = evaluateInviteGrant(base({ rankLevel: STAFF_LEVEL }), NOW);
    expect(d.action).toBe('none');
    expect(d.reason).toContain('staff rank');
  });

  it('skips a rank with no rate — the fail-closed default', () => {
    const d = evaluateInviteGrant(base({ perPeriod: 0 }), NOW);
    expect(d.action).toBe('none');
    expect(d.reason).toBe('rank earns no invites');
  });

  it('skips a rank with a rate but no cap rather than granting into a zero ceiling', () => {
    const d = evaluateInviteGrant(base({ perPeriod: 2, cap: 0 }), NOW);
    expect(d.action).toBe('none');
    expect(d.reason).toBe('rank holds no invites');
  });
});

describe('evaluateInviteGrant — standing gate', () => {
  const cases: Array<[Standing, 'grant' | 'none']> = [
    ['pristine', 'grant'],
    ['clean', 'grant'],
    ['neutral', 'grant'],
    ['poor', 'none'],
    ['hammer', 'none']
  ];

  it.each(cases)('standing %s → %s', (standing, action) => {
    expect(evaluateInviteGrant(base({ standing }), NOW).action).toBe(action);
  });

  it('names the tier so the dry-run log says which rule spared them', () => {
    expect(evaluateInviteGrant(base({ standing: 'poor' }), NOW).reason).toBe(
      'poor standing'
    );
  });

  it('isStandingDenied agrees with the evaluator', () => {
    expect(isStandingDenied('poor')).toBe(true);
    expect(isStandingDenied('hammer')).toBe(true);
    expect(isStandingDenied('neutral')).toBe(false);
  });
});

describe('evaluateInviteGrant — tenure floor', () => {
  it('withholds below the floor even when the period has elapsed', () => {
    const d = evaluateInviteGrant(
      base({
        dateRegistered: daysAgo(MIN_TENURE_DAYS - 1),
        lastInviteGrantAt: null
      }),
      NOW
    );
    expect(d.action).toBe('none');
    expect(d.reason).toContain('tenure');
  });

  it('grants once the floor is cleared', () => {
    const d = evaluateInviteGrant(
      base({
        dateRegistered: daysAgo(MIN_TENURE_DAYS),
        lastInviteGrantAt: null
      }),
      NOW
    );
    expect(d.action).toBe('grant');
  });

  // The floor is the one part of the rule rank configuration cannot override —
  // a fresh account has no warnings, so standing computes as `clean` and would
  // otherwise let a rate set on the default rank mint invites on day one.
  it('outranks a generous rank configuration', () => {
    const d = evaluateInviteGrant(
      base({
        perPeriod: 99,
        cap: 99,
        dateRegistered: daysAgo(1),
        lastInviteGrantAt: null,
        standing: 'clean'
      }),
      NOW
    );
    expect(d.action).toBe('none');
  });
});

describe('evaluateInviteGrant — the clock', () => {
  it('falls back to dateRegistered when never evaluated', () => {
    const registered = daysAgo(40);
    expect(
      grantClockOrigin(
        base({ lastInviteGrantAt: null, dateRegistered: registered })
      )
    ).toBe(registered);
  });

  it('prefers the stamp once one exists', () => {
    const stamp = daysAgo(3);
    expect(grantClockOrigin(base({ lastInviteGrantAt: stamp }))).toBe(stamp);
  });

  it('withholds inside the period', () => {
    const d = evaluateInviteGrant(
      base({ lastInviteGrantAt: daysAgo(PERIOD_DAYS - 1) }),
      NOW
    );
    expect(d.action).toBe('none');
    expect(d.reason).toContain(`${PERIOD_DAYS}d period`);
  });

  it('grants exactly at the period boundary', () => {
    expect(
      evaluateInviteGrant(
        base({ lastInviteGrantAt: daysAgo(PERIOD_DAYS) }),
        NOW
      ).action
    ).toBe('grant');
  });

  // No back-pay: an outage costs the site nothing and the member one period.
  // Six periods of downtime must not pay out six periods in the catch-up pass.
  it('grants one period after a long gap, never a backlog', () => {
    const d = evaluateInviteGrant(
      base({ lastInviteGrantAt: daysAgo(PERIOD_DAYS * 6), perPeriod: 2 }),
      NOW
    );
    expect(d.action).toBe('grant');
    expect(d.amount).toBe(2);
  });
});

describe('evaluateInviteGrant — the cap', () => {
  it('grants when there is room for the full amount', () => {
    const d = evaluateInviteGrant(
      base({ balance: 4, cap: 6, perPeriod: 2 }),
      NOW
    );
    expect(d.action).toBe('grant');
    expect(d.amount).toBe(2);
  });

  // Room is measured against the FULL grant, so a member between cap-n and cap
  // receives nothing rather than a partial top-up. That is what lets the write
  // be a conditional increment instead of a read-modify-write.
  it('advances without granting when a full amount would overshoot', () => {
    const d = evaluateInviteGrant(
      base({ balance: 5, cap: 6, perPeriod: 2 }),
      NOW
    );
    expect(d.action).toBe('advance');
    expect(d.amount).toBe(0);
  });

  it('advances at the cap', () => {
    const d = evaluateInviteGrant(
      base({ balance: 6, cap: 6, perPeriod: 2 }),
      NOW
    );
    expect(d.action).toBe('advance');
    expect(d.reason).toContain('period spent');
  });

  // The rule that keeps accrual from degenerating into top-up-to-cap: a member
  // who holds at cap has their clock moved anyway, so spending down does not
  // make them instantly eligible. A hoarder must not earn faster than a spender.
  it('a clamped member re-enters the queue at the next period, not on spending', () => {
    const held = evaluateInviteGrant(base({ balance: 6, cap: 6 }), NOW);
    expect(held.action).toBe('advance');

    // Clock now reads `NOW`. They spend everything an hour later.
    const spentSoon = evaluateInviteGrant(
      base({ balance: 0, cap: 6, lastInviteGrantAt: NOW }),
      new Date(NOW.getTime() + 3_600_000)
    );
    expect(spentSoon.action).toBe('none');

    const spentLater = evaluateInviteGrant(
      base({ balance: 0, cap: 6, lastInviteGrantAt: NOW }),
      new Date(NOW.getTime() + PERIOD_DAYS * DAY_MS)
    );
    expect(spentLater.action).toBe('grant');
  });
});
