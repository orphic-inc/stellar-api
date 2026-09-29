/**
 * The donor expiry job's failure policy (#596, ADR-0048): set-based writes.
 * One transaction deletes every expired grant by condition, so a failed run
 * changes nothing and the next hourly run finds the same rows.
 */
const mockTransaction = jest.fn();
jest.mock('../lib/prisma', () => ({
  prisma: { $transaction: (...args: unknown[]) => mockTransaction(...args) }
}));

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('./logging', () => ({ getLogger: () => mockLog }));

import { startDonorExpiryJob } from './donorExpiryJob';

const HOUR_MS = 60 * 60 * 1000;

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('startDonorExpiryJob — a failed run', () => {
  it('logs the failure and runs again on the next tick', async () => {
    mockTransaction
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValue(undefined);

    startDonorExpiryJob();
    await jest.advanceTimersByTimeAsync(30_000);

    expect(mockLog.error).toHaveBeenCalledWith(
      'Donor expiry sweep failed',
      expect.anything()
    );

    await jest.advanceTimersByTimeAsync(HOUR_MS);
    expect(mockTransaction).toHaveBeenCalledTimes(2);
  });

  // Deleting by condition, not by a list read earlier, is what makes a failed
  // run safe to repeat: nothing it read can go stale.
  it('deletes by condition, so the next run finds whatever this one missed', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
    mockTransaction.mockImplementation(
      (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ userDonorRank: { deleteMany }, $executeRaw: jest.fn() })
    );

    startDonorExpiryJob();
    await jest.advanceTimersByTimeAsync(30_000);

    expect(deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lte: expect.any(Date) } }
    });
  });
});
