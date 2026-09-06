/**
 * `STELLAR_TRUST_PROXY_HOPS` parsing (#542).
 *
 * The value describes deployment topology, so a bad one must not take the site
 * down — but it also must not silently over-trust, because over-trusting is the
 * vulnerability itself. Both halves are pinned here.
 */
describe('trustProxyHops', () => {
  const load = (value?: string) => {
    jest.resetModules();
    const prev = process.env.STELLAR_TRUST_PROXY_HOPS;
    if (value === undefined) delete process.env.STELLAR_TRUST_PROXY_HOPS;
    else process.env.STELLAR_TRUST_PROXY_HOPS = value;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { http } = require('./config') as typeof import('./config');
    if (prev === undefined) delete process.env.STELLAR_TRUST_PROXY_HOPS;
    else process.env.STELLAR_TRUST_PROXY_HOPS = prev;
    return http.trustProxyHops;
  };

  it('defaults to one hop — the shipped nginx topology', () => {
    expect(load(undefined)).toBe(1);
    expect(load('')).toBe(1);
  });

  it('accepts an explicit count, including zero for proxy-less local dev', () => {
    expect(load('0')).toBe(0);
    expect(load('2')).toBe(2);
  });

  it('falls back to 1 rather than crashing boot on nonsense', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    for (const bad of ['abc', '-1', '1.5']) {
      expect(load(bad)).toBe(1);
    }
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('never silently over-trusts on a bad value', () => {
    // The fallback must be the SAFE end of the mistake. Too few trusted hops
    // degrades IP accuracy; too many trusts attacker input, which is the bug.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(load('99999')).toBe(99999); // explicit and valid — the operator's call
    expect(load('not-a-number')).toBe(1); // invalid — never a large number
    warn.mockRestore();
  });
});
