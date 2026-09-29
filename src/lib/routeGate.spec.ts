import { markGate, markNotGate, readGate, readNotGate } from './routeGate';

const noop = () => undefined;

describe('markNotGate (#558)', () => {
  it('records why a middleware is not a gate', () => {
    const fn = markNotGate(noop.bind(null), 'parses cookies; refuses nothing');
    expect(readNotGate(fn)).toBe('parses cookies; refuses nothing');
    expect(readGate(fn)).toBeUndefined();
  });

  // The reason is the point: calling a gate inert must take a sentence a
  // reviewer can dispute, not a bare flag.
  it('refuses to mark without a reason', () => {
    expect(() => markNotGate(noop.bind(null), '')).toThrow(/needs a reason/);
    expect(() => markNotGate(noop.bind(null), '   ')).toThrow(/needs a reason/);
  });

  it('reads nothing off an unmarked function or a non-function', () => {
    expect(readNotGate(noop.bind(null))).toBeUndefined();
    expect(readNotGate(undefined)).toBeUndefined();
  });

  it('keeps the two marks apart', () => {
    const fn = markGate(noop.bind(null), 'auth');
    expect(readNotGate(fn)).toBeUndefined();
  });
});
