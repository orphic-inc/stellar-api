import { checkGateMarks, formatGateMarkReport } from './gateMarkCoverage';

describe('checkGateMarks (#558)', () => {
  it('passes when no contract route has an unmarked layer', () => {
    const result = checkGateMarks([
      { method: 'GET', path: '/api/a', unmarked: [] },
      { method: 'GET', path: '/api/b' }
    ]);
    expect(result).toEqual({ ok: true, unmarked: [], routes: 2 });
  });

  it('fails on every unmarked layer, naming its route', () => {
    const result = checkGateMarks([
      {
        method: 'POST',
        path: '/api/forums/topic-notes',
        unmarked: ['route layer 2 (requireModerator)']
      }
    ]);
    expect(result.ok).toBe(false);
    expect(result.unmarked).toEqual([
      'POST /api/forums/topic-notes: route layer 2 (requireModerator)'
    ]);
    expect(formatGateMarkReport(result)).toContain('requireModerator');
  });

  // The same scope as the completeness and failure-coverage gates: dev tools,
  // the docs and liveness are outside the contract.
  it('ignores routes outside the contract', () => {
    const result = checkGateMarks([
      { method: 'GET', path: '/api/dev/status', unmarked: ['x'] },
      { method: 'GET', path: '/health', unmarked: ['x'] }
    ]);
    expect(result).toEqual({ ok: true, unmarked: [], routes: 0 });
  });
});
