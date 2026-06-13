/**
 * IRCScore — the pure, table-driven scorer for the CRS IRC dimension
 * (PRD-01 / PRD-02, ADR-0012). Built and unit-tested against fixtures as the
 * red-green seam, before any IRC infra exists. No DB, no clock except the
 * injected `now`.
 *
 *   IRCScore       = CAP × (1 − exp(−(weightedVolume × consistency) / TAU))
 *   weightedVolume = Σ_row  min(msgCount, DAILY_CAP) × channelWeight
 *   consistency    = distinctActiveDays / windowDays   // active day = ≥ MIN_MSGS msgs
 *
 * Anti-farming is structural, not a bolt-on:
 *   - the per-channel/day cap (DAILY_CAP) means flooding doesn't scale,
 *   - `consistency` means one marathon session scores near-zero — regular
 *     presence over many days is the only real lever,
 *   - `channelWeight` means spamming a low-value channel is worth little.
 */

/** A trailing-window IrcActivity row, as fetched by the CRS assembler. */
export interface IrcActivityRow {
  channel: string;
  day: Date;
  msgCount: number;
}

export interface IrcScoreConfig {
  /** Max contribution of this dimension (clamped by the registry too). */
  cap: number;
  /** Diminishing-returns rate over `weightedVolume × consistency`. */
  tau: number;
  /** Per-channel/day counted-message ceiling (anti-flood). */
  dailyCap: number;
  /** A day counts toward consistency only with ≥ this many total messages. */
  minMsgs: number;
  /** Trailing window length in days (consistency denominator). */
  windowDays: number;
  /** Per-channel quality weights; channels absent here use `defaultChannelWeight`. */
  channelWeights: Record<string, number>;
  defaultChannelWeight: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * PROVISIONAL magnitudes — hand-pinned later (HITL, #141), exactly like every
 * other CRS magnitude (cf. longevity/ratio/friends τ+caps). The shape and the
 * anti-farming properties are what this slice locks down; the numbers are not.
 */
export const IRC_SCORE_CONFIG: IrcScoreConfig = {
  cap: 6,
  tau: 600,
  dailyCap: 50,
  minMsgs: 5,
  windowDays: 90,
  channelWeights: {
    '#announce': 0.5,
    '#general': 1.0,
    '#help': 1.2
  },
  defaultChannelWeight: 1.0
};

const utcDayKey = (d: Date): string =>
  `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;

/** Pure IRCScore over a window of rollup rows. Returns the raw (pre-clamp) score. */
export const scoreIrcActivity = (
  rows: IrcActivityRow[],
  config: IrcScoreConfig,
  now: Date
): number => {
  const windowStart = new Date(now.getTime() - config.windowDays * DAY_MS);

  let weightedVolume = 0;
  const msgsByDay = new Map<string, number>();

  for (const row of rows) {
    if (row.day < windowStart || row.day > now) continue;
    const weight =
      config.channelWeights[row.channel] ?? config.defaultChannelWeight;
    weightedVolume += Math.min(row.msgCount, config.dailyCap) * weight;
    const key = utcDayKey(row.day);
    msgsByDay.set(key, (msgsByDay.get(key) ?? 0) + row.msgCount);
  }

  let activeDays = 0;
  for (const dayTotal of msgsByDay.values()) {
    if (dayTotal >= config.minMsgs) activeDays++;
  }
  const consistency = activeDays / config.windowDays;

  return (
    config.cap * (1 - Math.exp(-(weightedVolume * consistency) / config.tau))
  );
};
