/**
 * The asset sweep's failure policy (#596, ADR-0048): set-based writes. Each
 * cycle runs two independent `deleteMany` tasks, and one failing must not stop
 * the other. Each task's own rules are in assetSweep.spec.ts.
 */
const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('./logging', () => ({ getLogger: () => mockLog }));

const mockSweepOrphanedAssets = jest.fn();
const mockPruneUnreferencedRemoteImages = jest.fn();
jest.mock('./assetSweep', () => ({
  sweepOrphanedAssets: () => mockSweepOrphanedAssets(),
  pruneUnreferencedRemoteImages: () => mockPruneUnreferencedRemoteImages()
}));

import { startAssetSweepJob } from './assetSweepJob';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('startAssetSweepJob — a failing task', () => {
  it('still prunes remote images when the orphan sweep throws', async () => {
    mockSweepOrphanedAssets.mockRejectedValue(new Error('connection lost'));
    mockPruneUnreferencedRemoteImages.mockResolvedValue(0);

    startAssetSweepJob();
    await jest.advanceTimersByTimeAsync(5 * 60_000);

    expect(mockPruneUnreferencedRemoteImages).toHaveBeenCalledTimes(1);
    expect(mockLog.error).toHaveBeenCalledWith(
      'Asset orphan sweep failed',
      expect.anything()
    );
  });
});
