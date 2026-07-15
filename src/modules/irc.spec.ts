/**
 * Unit tests for the IRCScore scorer and the channel-weight mechanism (#141).
 * getIrcScore is pure over the in-process metrics cache; we seed the cache via
 * pollKorinMetrics with a mocked fetch (the only writer).
 */

const mockKorin = {
  apiUrl: 'https://korin.test',
  pullKey: 'pk',
  pollIntervalMs: 1000,
  channelWeights: {} as Record<string, number>
};
jest.mock('./config', () => ({ korin: mockKorin }));
jest.mock('./logging', () => ({
  getLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

import { pollKorinMetrics, getIrcScore, IrcUserMetrics } from './irc';

const HOUR_MS = 3_600_000;

// A user whose three factors are all 1.0: msg == ACTIVITY_REF (50), full
// presence over the window, channelCount == CHANNEL_REF (5). Score == 1.
const fullUser = (over: Partial<IrcUserMetrics> = {}): IrcUserMetrics => ({
  nick: 'nova',
  presenceSeconds: HOUR_MS / 1000,
  messageCount: 50,
  channelCount: 5,
  channels: ['#a', '#b', '#c', '#d', '#e'],
  windowStart: 0,
  windowEnd: HOUR_MS,
  ...over
});

const seedCache = async (users: IrcUserMetrics[]): Promise<void> => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ users, lastFlushAt: HOUR_MS })
  }) as never;
  await pollKorinMetrics();
};

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  mockKorin.channelWeights = {};
});

describe('getIrcScore', () => {
  // Runs first, before any seedCache call, so the module cache is still empty —
  // exercising the "no cached flush" branch without re-importing the module.
  it('returns null when there is no cached flush', () => {
    expect(getIrcScore('nobody-has-polled')).toBeNull();
  });

  it('returns null when the nick is absent from the flush', async () => {
    await seedCache([fullUser({ nick: 'nova' })]);
    expect(getIrcScore('ghost')).toBeNull();
  });

  it('scores 1.0 when activity, consistency and channelQuality all saturate', async () => {
    await seedCache([fullUser()]);
    expect(getIrcScore('nova')).toBeCloseTo(1, 10);
  });

  it('halves the score when presence covers half the window', async () => {
    await seedCache([fullUser({ presenceSeconds: HOUR_MS / 2 / 1000 })]);
    expect(getIrcScore('nova')).toBeCloseTo(0.5, 10);
  });

  describe('channel-weight mechanism (#141)', () => {
    it('is neutral by default — an empty weight map uses channelCount, ignoring the channel list', async () => {
      // Two users, same channelCount, different joined-channel lists. With the
      // default empty map both must score identically (channels[] is unused).
      await seedCache([
        fullUser({
          nick: 'listy',
          channelCount: 3,
          channels: ['#a', '#b', '#c']
        }),
        fullUser({ nick: 'empty', channelCount: 3, channels: [] })
      ]);
      const listy = getIrcScore('listy');
      const empty = getIrcScore('empty');
      expect(listy).not.toBeNull();
      expect(listy).toBeCloseTo(empty as number, 12);
      // And it equals the raw-channelCount formula.
      const expected = Math.log1p(3) / Math.log1p(5); // activity=consistency=1
      expect(listy).toBeCloseTo(expected, 10);
    });

    it('applies configured per-channel weights over the joined channel list', async () => {
      mockKorin.channelWeights = { '#a': 2 }; // #b/#c fall back to default 1
      await seedCache([
        fullUser({
          nick: 'weighted',
          channelCount: 3,
          channels: ['#a', '#b', '#c']
        })
      ]);
      // effective = 2 + 1 + 1 = 4  (not the raw channelCount of 3)
      const expected = Math.log1p(4) / Math.log1p(5);
      const score = getIrcScore('weighted');
      expect(score).toBeCloseTo(expected, 10);
      // Sanity: this genuinely differs from the neutral channelCount=3 result.
      expect(score).not.toBeCloseTo(Math.log1p(3) / Math.log1p(5), 3);
    });

    it('treats a zero weight as fully discounting a channel', async () => {
      mockKorin.channelWeights = { '#firehose': 0 };
      await seedCache([
        fullUser({
          nick: 'quiet',
          channelCount: 2,
          channels: ['#firehose', '#niche']
        })
      ]);
      // effective = 0 + 1 = 1
      expect(getIrcScore('quiet')).toBeCloseTo(
        Math.log1p(1) / Math.log1p(5),
        10
      );
    });
  });
});
