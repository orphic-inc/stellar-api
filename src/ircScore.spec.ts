import {
  scoreIrcActivity,
  IRC_SCORE_CONFIG,
  type IrcActivityRow,
  type IrcScoreConfig
} from './modules/ircScore';
import { computeCrs } from './modules/reputation';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-06-13T12:00:00Z');
const BASE = Date.UTC(2026, 5, 13); // midnight UTC of "today"

/** A UTC-midnight day `n` days before today. */
const dayAgo = (n: number): Date => new Date(BASE - n * DAY_MS);

const row = (
  daysAgo: number,
  msgCount: number,
  channel = '#general'
): IrcActivityRow => ({ channel, day: dayAgo(daysAgo), msgCount });

const score = (
  rows: IrcActivityRow[],
  cfg: IrcScoreConfig = IRC_SCORE_CONFIG
) => scoreIrcActivity(rows, cfg, NOW);

// ─── basics ───────────────────────────────────────────────────────────────────

describe('scoreIrcActivity — basics', () => {
  it('scores zero for no activity', () => {
    expect(score([])).toBe(0);
  });

  it('never exceeds the cap and is non-negative', () => {
    const huge = Array.from({ length: 90 }, (_, i) => row(i, 10_000));
    const s = score(huge);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(IRC_SCORE_CONFIG.cap);
  });

  it('ignores rows outside the trailing window', () => {
    expect(score([row(120, 500)])).toBe(0);
  });
});

// ─── anti-farming structure ─────────────────────────────────────────────────

describe('scoreIrcActivity — anti-farming', () => {
  it('per-day cap defeats flooding: 10k msgs in a day == DAILY_CAP msgs', () => {
    const flood = score([row(0, 10_000)]);
    const capped = score([row(0, IRC_SCORE_CONFIG.dailyCap)]);
    expect(flood).toBeCloseTo(capped, 10);
  });

  it('consistency beats marathons: same weighted volume spread over more days scores higher', () => {
    // Both have weightedVolume = 50 (weight-1 channel):
    const marathon = score([row(0, 50)]); // 1 active day
    const regular = score(
      Array.from({ length: 10 }, (_, i) => row(i, 5)) // 10 active days × 5
    );
    expect(regular).toBeGreaterThan(marathon);
  });

  it('channel weight defeats low-value spam: same volume scores more in a higher-weight channel', () => {
    const announce = score([row(0, 20, '#announce')]); // weight 0.5
    const help = score([row(0, 20, '#help')]); // weight 1.2
    expect(help).toBeGreaterThan(announce);
  });

  it('a day below MIN_MSGS does not count toward consistency', () => {
    const below = score([row(0, IRC_SCORE_CONFIG.minMsgs - 1)]);
    // weightedVolume > 0 but consistency 0 → score 0.
    expect(below).toBe(0);
  });
});

// ─── monotonicity ─────────────────────────────────────────────────────────────

describe('scoreIrcActivity — monotonicity', () => {
  it('more active days yields a higher score', () => {
    const ten = score(Array.from({ length: 10 }, (_, i) => row(i, 20)));
    const thirty = score(Array.from({ length: 30 }, (_, i) => row(i, 20)));
    expect(thirty).toBeGreaterThan(ten);
  });
});

// ─── registry integration ─────────────────────────────────────────────────────

describe('IRCScore registration in CRS', () => {
  it('appears as an "irc" dimension, clamped to its cap', () => {
    const result = computeCrs({
      userId: 1,
      createdAt: NOW,
      now: NOW,
      ircActivity: Array.from({ length: 90 }, (_, i) => row(i, 10_000))
    });
    const irc = result.dimensions.find((d) => d.name === 'irc');
    expect(irc).toBeDefined();
    expect(irc!.subScore).toBeLessThanOrEqual(IRC_SCORE_CONFIG.cap);
    expect(irc!.subScore).toBeGreaterThan(0);
  });

  it('contributes zero when a user has no IRC activity', () => {
    const result = computeCrs({ userId: 1, createdAt: NOW, now: NOW });
    const irc = result.dimensions.find((d) => d.name === 'irc');
    expect(irc!.subScore).toBe(0);
  });
});
