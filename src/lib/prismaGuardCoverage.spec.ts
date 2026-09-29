/**
 * The ratchet's three failure modes, asserted by BREAKING it (#564).
 *
 * A suppression list nothing audits is how the original gap survived for four
 * published counts, so each rule below is proved by constructing the state it
 * must reject — not by checking the happy path still passes.
 */
import {
  checkPrismaGuardCoverage,
  isGatedSite,
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
    // The mechanism an ungated area uses. Since ADR-0048 the real gate covers
    // every area, so this pins the comparator, not the policy.
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

  // ── ADR-0048 (#596): modules and lib are gated; devTools is not ─────────────
  const everyArea = (sites: MutationSite[], b: Baseline) =>
    checkPrismaGuardCoverage({
      sites,
      baseline: b,
      gated: ['routes', 'modules', 'lib']
    });

  it('fails on an unguarded module site once modules are gated', () => {
    const key = 'src/modules/forum.ts::updateTopic::forumTopic.update';
    const r = everyArea([site({ area: 'modules', key, arm: 'B' })], baseline());
    expect(r.ok).toBe(false);
    expect(r.newlyUnguarded).toEqual([key]);
  });

  // Narrowing the gate must not pass silently: the backlog's entries would all
  // still match live, unguarded sites, so rules 2 and 3 alone never fire.
  it('fails an entry whose site the gate no longer covers', () => {
    const key = 'src/modules/forum.ts::updateTopic::forumTopic.update';
    const r = run(
      [site({ area: 'modules', key, arm: 'B' })],
      baseline({ unreviewed: [key] })
    );
    expect(r.ok).toBe(false);
    expect(r.staleBaseline).toEqual([key]);
  });

  it('never fails on a dev-only path, and counts it apart', () => {
    const key =
      'src/modules/devTools/generators/releases.ts::f::release.create';
    const r = everyArea([site({ area: 'modules', key })], baseline());
    expect(r.ok).toBe(true);
    expect(r.newlyUnguarded).toEqual([]);
    expect(r.totals.devOnly).toBe(1);
    expect(r.totals.countedOnly).toBe(0);
  });

  it('matches the dev-only prefix by path, not by a name containing it', () => {
    const key = 'src/modules/devToolsAudit.ts::f::thing.create';
    const r = everyArea([site({ area: 'modules', key })], baseline());
    expect(r.ok).toBe(false);
  });
});

describe('isGatedSite', () => {
  it('gates a site in a gated area', () => {
    expect(
      isGatedSite(site({ area: 'lib', key: 'src/lib/x.ts::f::t.create' }), [
        'lib'
      ])
    ).toBe(true);
  });

  it('never gates a dev-only site, whatever the areas', () => {
    const dev = site({
      area: 'modules',
      key: 'src/modules/devTools/cleanup.ts::f::t.delete'
    });
    expect(isGatedSite(dev, ['routes', 'modules', 'lib'])).toBe(false);
  });
});
