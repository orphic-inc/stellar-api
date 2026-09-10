/**
 * Unit tests for the inactivity evaluator (#279, ADR-0038).
 *
 * The evaluator is pure — no DB, no I/O — so these need no Prisma mock. Every
 * case fixes `now` and expresses the input as an offset from it, because the
 * whole rule is date arithmetic and a test that used real "today" would drift.
 *
 * The thresholds are imported rather than restated: a test that hard-coded 110
 * would keep passing if the constant moved, which is exactly the drift it
 * exists to catch.
 */
import {
  evaluateInactivity,
  lastActivityAt,
  InactivityInput,
  DAY_MS,
  WARN_AFTER_DAYS,
  DISABLE_AFTER_DAYS,
  WARN_GRACE_DAYS,
  NEVER_LOGGED_IN_DAYS,
  STAFF_LEVEL
} from './inactivity';

const NOW = new Date('2026-09-10T12:00:00.000Z');
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * DAY_MS);

/** An ordinary member, active yesterday, exempt from nothing. */
const base = (over: Partial<InactivityInput> = {}): InactivityInput => ({
  lastLogin: daysAgo(1),
  dateRegistered: daysAgo(400),
  reactivatedAt: null,
  inactivityWarnedAt: null,
  disabled: false,
  isDonor: false,
  rankLocked: false,
  rankLevel: 100,
  adminCreated: false,
  ...over
});

describe('lastActivityAt', () => {
  it('takes the most recent of registration, login and reactivation', () => {
    expect(
      lastActivityAt(
        base({
          dateRegistered: daysAgo(400),
          lastLogin: daysAgo(200),
          reactivatedAt: daysAgo(3)
        })
      )
    ).toEqual(daysAgo(3));
  });

  it('falls back to registration for an account that never logged in', () => {
    expect(
      lastActivityAt(base({ lastLogin: null, dateRegistered: daysAgo(9) }))
    ).toEqual(daysAgo(9));
  });

  it('ignores a reactivation older than the last login', () => {
    expect(
      lastActivityAt(
        base({ lastLogin: daysAgo(2), reactivatedAt: daysAgo(80) })
      )
    ).toEqual(daysAgo(2));
  });
});

describe('evaluateInactivity — the warn arm', () => {
  it('leaves an active member alone', () => {
    expect(evaluateInactivity(base(), NOW).action).toBe('none');
  });

  it('does not warn the day before the threshold', () => {
    const d = evaluateInactivity(
      base({ lastLogin: daysAgo(WARN_AFTER_DAYS - 1) }),
      NOW
    );
    expect(d.action).toBe('none');
  });

  it('warns on the threshold', () => {
    const d = evaluateInactivity(
      base({ lastLogin: daysAgo(WARN_AFTER_DAYS) }),
      NOW
    );
    expect(d.action).toBe('warn');
  });

  it('does not warn twice — a stamped warn is not re-warned', () => {
    const d = evaluateInactivity(
      base({
        lastLogin: daysAgo(WARN_AFTER_DAYS + 2),
        inactivityWarnedAt: daysAgo(2)
      }),
      NOW
    );
    expect(d.action).toBe('none');
  });
});

describe('evaluateInactivity — the disable arm', () => {
  it('does not disable an unwarned account, however idle', () => {
    // The stamp is the only evidence the member was told. Without it, an
    // account idle for years is warned first and disabled a week later.
    const d = evaluateInactivity(
      base({ lastLogin: daysAgo(900), inactivityWarnedAt: null }),
      NOW
    );
    expect(d.action).toBe('warn');
  });

  it('does not disable before the grace period has elapsed', () => {
    const d = evaluateInactivity(
      base({
        lastLogin: daysAgo(DISABLE_AFTER_DAYS + 5),
        inactivityWarnedAt: daysAgo(WARN_GRACE_DAYS - 1)
      }),
      NOW
    );
    expect(d.action).toBe('none');
  });

  it('disables once idle and warned long enough', () => {
    const d = evaluateInactivity(
      base({
        lastLogin: daysAgo(DISABLE_AFTER_DAYS),
        inactivityWarnedAt: daysAgo(WARN_GRACE_DAYS)
      }),
      NOW
    );
    expect(d.action).toBe('disable');
  });

  it('cannot warn and disable in one catch-up pass after job downtime', () => {
    // The grace is measured from the STAMP, not the calendar, so a job that has
    // been down for a month still owes this member a week's notice.
    const d = evaluateInactivity(
      base({ lastLogin: daysAgo(500), inactivityWarnedAt: null }),
      NOW
    );
    expect(d.action).toBe('warn');
  });
});

describe('evaluateInactivity — exemptions', () => {
  const veryIdle = {
    lastLogin: daysAgo(900),
    inactivityWarnedAt: daysAgo(400)
  };

  it.each([
    ['already disabled', { disabled: true }],
    ['staff rank', { rankLevel: STAFF_LEVEL }],
    ['above staff rank', { rankLevel: 1000 }],
    ['rankLocked', { rankLocked: true }],
    ['active donor', { isDonor: true }]
  ])('never touches %s', (_label, over) => {
    const d = evaluateInactivity(base({ ...veryIdle, ...over }), NOW);
    expect(d.action).toBe('none');
  });

  it('exempts from the WARN too, not just the disable', () => {
    // Checked before either arm, so an exempt member is never mailed either.
    const d = evaluateInactivity(
      base({ lastLogin: daysAgo(WARN_AFTER_DAYS), isDonor: true }),
      NOW
    );
    expect(d.action).toBe('none');
  });

  it('sweeps a lapsed donor, warning first', () => {
    // donorExpiryJob clears isDonor when the last grant lapses, so the
    // exemption tracks a live state. The warn arm still applies.
    const d = evaluateInactivity(
      base({ lastLogin: daysAgo(900), isDonor: false }),
      NOW
    );
    expect(d.action).toBe('warn');
  });
});

describe('evaluateInactivity — never logged in', () => {
  it('sweeps a self-registration that never returned', () => {
    const d = evaluateInactivity(
      base({ lastLogin: null, dateRegistered: daysAgo(NEVER_LOGGED_IN_DAYS) }),
      NOW
    );
    expect(d.action).toBe('disable');
  });

  it('leaves a fresh registration alone', () => {
    const d = evaluateInactivity(
      base({
        lastLogin: null,
        dateRegistered: daysAgo(NEVER_LOGGED_IN_DAYS - 1)
      }),
      NOW
    );
    expect(d.action).toBe('none');
  });

  it('never sweeps an admin-created account', () => {
    // Staff make an account for someone who is away for a fortnight; the sweep
    // is for abandoned self-registrations, not for accounts handed out.
    const d = evaluateInactivity(
      base({
        lastLogin: null,
        dateRegistered: daysAgo(400),
        adminCreated: true
      }),
      NOW
    );
    expect(d.action).toBe('none');
  });
});

describe('evaluateInactivity — reinstatement', () => {
  it('does NOT re-disable a member staff just re-enabled', () => {
    // The bug this column exists to prevent: re-enable sets `disabled` false
    // and touches nothing else, so without reactivatedAt the disable predicate
    // is satisfied again the next morning.
    const d = evaluateInactivity(
      base({
        lastLogin: daysAgo(900),
        inactivityWarnedAt: null,
        reactivatedAt: daysAgo(1)
      }),
      NOW
    );
    expect(d.action).toBe('none');
  });

  it('does not re-sweep a reinstated account that never logged in', () => {
    // lastLogin is STILL null after a re-enable, so the never-logged-in arm
    // would fire on its own terms if it did not read reactivatedAt.
    const d = evaluateInactivity(
      base({
        lastLogin: null,
        dateRegistered: daysAgo(400),
        reactivatedAt: daysAgo(1)
      }),
      NOW
    );
    expect(d.action).toBe('none');
  });

  it('gives a reinstated member the full window again, then warns', () => {
    const d = evaluateInactivity(
      base({
        lastLogin: daysAgo(900),
        reactivatedAt: daysAgo(WARN_AFTER_DAYS)
      }),
      NOW
    );
    expect(d.action).toBe('warn');
  });
});
