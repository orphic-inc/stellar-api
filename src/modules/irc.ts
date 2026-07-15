/**
 * IRC integration module — korin.pink bridge client + IRCScore scorer.
 *
 * Architecture (ADR-0005):
 *   stellar-api polls GET /irc/metrics from korin-pink every KORIN_POLL_INTERVAL_MS.
 *   The last flush is cached in-process (TtlCache). The IRCScore scorer reads the
 *   cache — it is a pure function of the cached signals, consistent with ADR-0007
 *   (CRS computed on read; no score column that can drift).
 *
 * IRCScore formula (PRD-01 v0.1.x):
 *   IRCScore = activity × consistency × channelQuality   (then clamped to cap)
 *
 *   activity       = log1p(messageCount) / log1p(ACTIVITY_REF)   → [0, 1]
 *   consistency    = min(presenceSeconds / windowDuration, 1)     → [0, 1]
 *   channelQuality = log1p(channelCount) / log1p(CHANNEL_REF)    → [0, 1]
 *
 * The product of three [0,1] factors keeps the score bounded naturally before
 * the reputation registry applies its own cap. Log-scaling on message count and
 * channel count prevents spammers/lurkers from dominating by sheer volume.
 */

import { korin as korinConfig } from './config';
import { TtlCache } from '../lib/ttlCache';
import { getLogger } from './logging';

const log = getLogger('irc');

// ─── Types (mirrors korin-pink UserMetrics shape) ──────────────────────────

export interface IrcUserMetrics {
  nick: string;
  stellarId?: string;
  presenceSeconds: number;
  messageCount: number;
  channelCount: number;
  channels: string[];
  windowStart: number;
  windowEnd: number;
}

export interface IrcMetricsPayload {
  users: IrcUserMetrics[];
  lastFlushAt: number | null;
}

// ─── Cache ──────────────────────────────────────────────────────────────────

const cache = new TtlCache();
const CACHE_KEY = 'irc:metrics';
// TTL is 2× poll interval so a missed poll doesn't evict valid data mid-read
const cacheTtlMs = (): number => korinConfig.pollIntervalMs * 2;

export const getCachedMetrics = (): IrcMetricsPayload | undefined =>
  cache.get<IrcMetricsPayload>(CACHE_KEY);

// ─── Korin polling client ───────────────────────────────────────────────────

export const pollKorinMetrics = async (): Promise<void> => {
  const { apiUrl, pullKey } = korinConfig;
  if (!apiUrl || !pullKey) {
    log.warn('KORIN_API_URL or KORIN_PULL_KEY not set — IRC metrics disabled');
    return;
  }

  try {
    const res = await fetch(`${apiUrl}/irc/metrics`, {
      headers: { 'x-pull-key': pullKey }
    });
    if (!res.ok) {
      log.warn('korin /irc/metrics returned non-200', { status: res.status });
      return;
    }
    const payload = (await res.json()) as IrcMetricsPayload;
    cache.set(CACHE_KEY, payload, cacheTtlMs());
    log.info('IRC metrics refreshed', { users: payload.users.length });
  } catch (err) {
    log.error('Failed to poll korin IRC metrics', { err });
  }
};

// ─── IRCScore scorer (pure — no DB, no clock) ───────────────────────────────

/** Reference message count where activity reaches ~63% of max (log-scaled). */
const ACTIVITY_REF = 50;
/** Reference channel count where channelQuality reaches ~63% of max. */
const CHANNEL_REF = 5;
/** Weight applied to a channel absent from the configured weight map (#141). */
const DEFAULT_CHANNEL_WEIGHT = 1;

/**
 * Effective channel count feeding channelQuality (#141). Empty weight map (the
 * default) returns the raw `channelCount` — weights are deferred until real
 * multi-channel traffic exists to calibrate them (PRD-02). A configured map
 * instead sums per-channel weights over the user's joined `channels`.
 */
const effectiveChannelCount = (user: IrcUserMetrics): number => {
  const weights = korinConfig.channelWeights;
  if (Object.keys(weights).length === 0) return user.channelCount;
  return user.channels.reduce(
    (sum, channel) => sum + (weights[channel] ?? DEFAULT_CHANNEL_WEIGHT),
    0
  );
};

/**
 * Compute IRCScore factors for a nick from a single flush window.
 * Returns null if the nick has no data in the current cached flush.
 */
export const getIrcScore = (nick: string): number | null => {
  const payload = getCachedMetrics();
  if (!payload) return null;

  const user = payload.users.find((u) => u.nick === nick);
  if (!user) return null;

  const windowDurationSeconds = (user.windowEnd - user.windowStart) / 1000 || 1;

  const activity = Math.log1p(user.messageCount) / Math.log1p(ACTIVITY_REF);
  const consistency = Math.min(user.presenceSeconds / windowDurationSeconds, 1);
  const channelQuality =
    Math.log1p(effectiveChannelCount(user)) / Math.log1p(CHANNEL_REF);

  return activity * consistency * channelQuality;
};
