/**
 * The link-health job's failure policy (#596, ADR-0048): catch, log, continue.
 * Its two tasks are independent, so a failed recheck must not stop the WARN
 * sweep. The per-contribution half lives in linkHealth.spec.ts.
 */
const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('./logging', () => ({ getLogger: () => mockLog }));

const mockRecheckStaleLinks = jest.fn();
const mockSweepStaleWarnLinks = jest.fn();
jest.mock('./linkHealth', () => ({
  recheckStaleLinks: () => mockRecheckStaleLinks(),
  sweepStaleWarnLinks: () => mockSweepStaleWarnLinks()
}));

import { startLinkHealthJob } from './linkHealthJob';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('startLinkHealthJob — a failing task', () => {
  it('still sweeps stale WARN links when the recheck throws', async () => {
    mockRecheckStaleLinks.mockRejectedValue(new Error('connection lost'));
    mockSweepStaleWarnLinks.mockResolvedValue(undefined);

    startLinkHealthJob();
    await jest.advanceTimersByTimeAsync(60_000);

    expect(mockSweepStaleWarnLinks).toHaveBeenCalledTimes(1);
    expect(mockLog.error).toHaveBeenCalledWith(
      'Stale link recheck failed',
      expect.anything()
    );
  });
});
