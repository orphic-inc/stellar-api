/**
 * The ratchet's three failure modes, asserted by BREAKING it (#564).
 *
 * A suppression list nothing audits is how the original gap survived for four
 * published counts, so each rule below is proved by constructing the state it
 * must reject — not by checking the happy path still passes.
 */
import {
  checkPrismaGuardCoverage,
  type Baseline,
  type MutationSite
} from './prismaGuardCoverage';

const site = (over: Partial<MutationSite> = {}): MutationSite => ({
  key: 'POST /things::thing.create',
  area: 'routes',
  model: 'thing',
  op: 'create',
  arm: 'A',
  guarded: false,
  ...over
});

const baseline = (over: Partial<Baseline> = {}): Baseline => ({
  internallyDerived: {},
  unreviewed: [],
  ...over
});

const run = (sites: MutationSite[], b: Baseline) =>
  checkPrismaGuardCoverage({ sites, baseline: b, gated: ['routes'] });

describe('guard-coverage ratchet', () => {
  it('RULE 1 — an unguarded candidate absent from the baseline fails', () => {
    const r = run([site()], baseline());
    expect(r.ok).toBe(false);
    expect(r.newlyUnguarded).toEqual(['POST /things::thing.create']);
  });

  it('RULE 2 — a baselined entry that is now guarded fails as stale', () => {
    // Without this the list could only grow: a site could be fixed and its
    // grant would linger, silently covering whatever later took its key.
    const r = run(
      [site({ guarded: true })],
      baseline({ unreviewed: ['POST /things::thing.create'] })
    );
    expect(r.ok).toBe(false);
    expect(r.staleBaseline).toEqual(['POST /things::thing.create']);
  });

  it('RULE 3 — a baselined entry matching no site fails as stale', () => {
    const r = run([], baseline({ unreviewed: ['POST /gone::gone.create'] }));
    expect(r.ok).toBe(false);
    expect(r.staleBaseline).toEqual(['POST /gone::gone.create']);
  });

  it('holds internallyDerived to the same staleness rules', () => {
    // The justified list is not privileged: a grant whose site is gone is just
    // as rotten as an unreviewed one, and rots more quietly because it reads
    // as reasoned.
    const r = run(
      [],
      baseline({
        internallyDerived: { 'POST /gone::gone.create': 'session id' }
      })
    );
    expect(r.ok).toBe(false);
    expect(r.staleBaseline).toEqual(['POST /gone::gone.create']);
  });

  it('passes when an unguarded candidate is baselined, and counts it', () => {
    const r = run(
      [site()],
      baseline({ unreviewed: ['POST /things::thing.create'] })
    );
    expect(r.ok).toBe(true);
    expect(r.totals.unreviewed).toBe(1);
    expect(r.allUnguarded).toEqual(['POST /things::thing.create']);
  });

  it('passes a guarded site with no baseline entry at all', () => {
    // A fix removes the need for an entry rather than requiring one, so the
    // baseline shrinks as the backlog burns down.
    const r = run([site({ guarded: true })], baseline());
    expect(r.ok).toBe(true);
    expect(r.totals.guarded).toBe(1);
  });

  it('ignores non-candidates entirely', () => {
    const r = run([site({ arm: null })], baseline());
    expect(r.ok).toBe(true);
    expect(r.totals.candidates).toBe(0);
    expect(r.totals.sites).toBe(1);
  });

  it('counts an ungated area without failing on it', () => {
    // src/modules is measured, not enforced: a module takes its ids as
    // arguments, so request-supplied cannot be told from internally-read
    // without inter-procedural analysis.
    const r = run(
      [site({ area: 'modules', key: 'm::f::thing.create' })],
      baseline()
    );
    expect(r.ok).toBe(true);
    expect(r.totals.countedOnly).toBe(1);
    expect(r.newlyUnguarded).toEqual([]);
  });

  it('fails on the gated area even when an ungated one is dirty', () => {
    const r = run(
      [site(), site({ area: 'modules', key: 'm::f::thing.create' })],
      baseline()
    );
    expect(r.ok).toBe(false);
    expect(r.newlyUnguarded).toEqual(['POST /things::thing.create']);
  });
});
