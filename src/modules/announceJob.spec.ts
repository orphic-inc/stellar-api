/**
 * Tests for the announce push job (#299) — cursor advance, in-order delivery,
 * at-least-once retry on failure, and the startup seed that prevents history
 * replay. The cycle logic is tested through the exported `runAnnounceCycle`
 * (no timers); the startup seed is tested through `startAnnounceJob` with fake
 * timers.
 */

const mockAggregate = jest.fn();
jest.mock('../lib/prisma', () => ({
  prisma: { contribution: { aggregate: mockAggregate } }
}));
jest.mock('./config', () => ({
  korin: { apiUrl: 'https://korin.test', pullKey: 'pk', pollIntervalMs: 1000 }
}));
jest.mock('./logging', () => ({
  getLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

const mockGetNewAnnounceItems = jest.fn();
const mockPublishAnnounceItem = jest.fn();
jest.mock('./announce', () => ({
  getNewAnnounceItems: mockGetNewAnnounceItems,
  publishAnnounceItem: mockPublishAnnounceItem
}));

import { runAnnounceCycle, startAnnounceJob } from './announceJob';
import { AnnounceItem } from './announce';

const item = (id: number): AnnounceItem => ({
  id,
  releaseId: id,
  title: `Release ${id}`,
  artists: ['Artist'],
  community: null,
  type: 'FLAC',
  createdAt: new Date('2026-06-15T00:00:00Z'),
  link: `https://stellar.test/releases/${id}`
});

beforeEach(() => {
  mockGetNewAnnounceItems.mockReset();
  mockPublishAnnounceItem.mockReset();
  mockAggregate.mockReset();
});

describe('runAnnounceCycle', () => {
  it('returns the same cursor and pushes nothing when there are no new items', async () => {
    mockGetNewAnnounceItems.mockResolvedValue([]);
    expect(await runAnnounceCycle(100)).toBe(100);
    expect(mockPublishAnnounceItem).not.toHaveBeenCalled();
  });

  it('pushes every new item in id order and advances to the last id', async () => {
    mockGetNewAnnounceItems.mockResolvedValue([item(1), item(2), item(3)]);
    mockPublishAnnounceItem.mockResolvedValue(true);

    expect(await runAnnounceCycle(0)).toBe(3);
    expect(mockPublishAnnounceItem.mock.calls.map(([i]) => i.id)).toEqual([
      1, 2, 3
    ]);
  });

  it('holds the cursor at the last success when a push fails mid-batch', async () => {
    mockGetNewAnnounceItems.mockResolvedValue([item(1), item(2), item(3)]);
    mockPublishAnnounceItem
      .mockResolvedValueOnce(true) // id 1
      .mockResolvedValueOnce(false); // id 2 fails

    // Cursor resumes at 1 (id 2 must be retried); id 3 is never attempted.
    expect(await runAnnounceCycle(0)).toBe(1);
    expect(mockPublishAnnounceItem.mock.calls.map(([i]) => i.id)).toEqual([
      1, 2
    ]);
  });

  it('retries the failed item on the next cycle — at-least-once, in-order', async () => {
    // korin's cursor query returns items strictly newer than `sinceId`.
    mockGetNewAnnounceItems.mockImplementation((sinceId: number) =>
      Promise.resolve(
        sinceId < 1 ? [item(1), item(2)] : sinceId < 2 ? [item(2)] : []
      )
    );
    mockPublishAnnounceItem
      .mockResolvedValueOnce(true) // cycle 1: id 1
      .mockResolvedValueOnce(false) // cycle 1: id 2 fails
      .mockResolvedValueOnce(true); // cycle 2: id 2 retried, succeeds

    const afterFirst = await runAnnounceCycle(0);
    expect(afterFirst).toBe(1);
    const afterSecond = await runAnnounceCycle(afterFirst);
    expect(afterSecond).toBe(2);

    // id 2 was pushed twice (the retry); id 1 exactly once.
    const pushed = mockPublishAnnounceItem.mock.calls.map(([i]) => i.id);
    expect(pushed).toEqual([1, 2, 2]);
  });
});

describe('startAnnounceJob — startup seed', () => {
  afterEach(() => jest.useRealTimers());

  it('seeds the cursor to the latest contribution so history is never replayed', async () => {
    jest.useFakeTimers();
    mockAggregate.mockResolvedValue({ _max: { id: 100 } });
    mockGetNewAnnounceItems.mockResolvedValue([]);

    startAnnounceJob();
    await jest.advanceTimersByTimeAsync(30_000); // STARTUP_DELAY_MS

    expect(mockAggregate).toHaveBeenCalledTimes(1);
    // The first fetch starts *after* id 100 — nothing already recorded is re-sent.
    expect(mockGetNewAnnounceItems).toHaveBeenCalledWith(100);
  });
});
