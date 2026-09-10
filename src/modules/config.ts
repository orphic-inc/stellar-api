import 'dotenv/config';

const requireEnv = (key: string, minLength = 0): string => {
  const value = process.env[key];
  if (!value) {
    console.error(`FATAL: Missing required environment variable: ${key}`);
    process.exit(1);
  }
  if (value.length < minLength) {
    console.error(`FATAL: ${key} must be at least ${minLength} characters`);
    process.exit(1);
  }
  return value;
};

// Parse the optional IRCScore channel-weight map (#141). Malformed input is
// non-fatal — a bad tuning value must not crash boot — so it fails soft to an
// empty map.
const parseChannelWeights = (raw?: string): Record<string, number> => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      console.warn('KORIN_CHANNEL_WEIGHTS is not a JSON object — ignoring');
      return {};
    }
    const out: Record<string, number> = {};
    for (const [channel, weight] of Object.entries(parsed)) {
      if (
        typeof weight === 'number' &&
        Number.isFinite(weight) &&
        weight >= 0
      ) {
        out[channel] = weight;
      } else {
        console.warn(
          `KORIN_CHANNEL_WEIGHTS["${channel}"] is not a non-negative number — ignoring`
        );
      }
    }
    return out;
  } catch {
    console.warn('KORIN_CHANNEL_WEIGHTS is not valid JSON — ignoring');
    return {};
  }
};

export const auth = {
  jwtSecret: requireEnv('STELLAR_AUTH_JWT_SECRET', 32)
};

export const logging = {
  level: process.env.STELLAR_LOG_LEVEL || 'info',
  timestampFormat: process.env.STELLAR_LOG_TIME_FMT
};

/**
 * How many reverse-proxy hops sit in front of this API (#542).
 *
 * Express's `trust proxy` decides which entry of `X-Forwarded-For` becomes
 * `req.ip`. In the shipped stack (stellar-compose) the `ui` service *is* nginx,
 * it owns ports 80/443, and `api` publishes none and lives on the `internal`
 * network — so exactly one hop is in front and it is always present. nginx sets
 * `X-Forwarded-For: $proxy_add_x_forwarded_for`, which **appends** the real peer
 * to whatever the client sent, so the rightmost entry is ours and everything to
 * its left is attacker-supplied. One trusted hop selects exactly that entry.
 *
 * Configurable because it describes deployment topology, not code: a local
 * `npm run dev` has no proxy at all and should set `0`, and a stack that later
 * grows a CDN or load balancer will need a different number. Defaulting to `1`
 * keeps the shipped topology correct without configuration.
 *
 * A negative or non-numeric value falls back to `1` rather than crashing boot —
 * getting this wrong should not take the site down, and `1` is the safe end of
 * the mistake: too few trusted hops under-trusts the header, which degrades IP
 * accuracy. Too many would trust attacker input, which is the bug itself.
 */
const parseTrustProxyHops = (raw?: string): number => {
  if (raw === undefined || raw === '') return 1;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    console.warn(
      `STELLAR_TRUST_PROXY_HOPS is not a non-negative integer ('${raw}') — using 1`
    );
    return 1;
  }
  return parsed;
};

export const http = {
  port: parseInt(process.env.STELLAR_HTTP_PORT || '8080', 10),
  corsOrigin: process.env.STELLAR_HTTP_CORS_ORIGIN || 'http://localhost:3000',
  trustProxyHops: parseTrustProxyHops(process.env.STELLAR_TRUST_PROXY_HOPS)
};

// Site identity + the canonical targets the Golden Rules `${...}` tokens resolve
// to at read time (PRD-09 / ADR-0020). `GET /api/rules/tree` ships these as a
// `variables` map the UI substitutes; the API single-sources the values here.
// `publicKbBase` is the public wiki root — korin.pink's Astro Starlight site,
// which hosts the guidance articles anyone may need BEFORE they have an account.
// That "before" is load-bearing: registration is invite-only, access runs through
// an Interview held on IRC, and every in-app wiki route sits behind requireAuth —
// so onboarding and IRC prose cannot live in the in-app wiki without locking
// applicants out of the front door. IRC is korin's system, so korin documents it
// and we link (#126).
export const site = {
  name: process.env.STELLAR_SITE_NAME || 'Stellar',
  ircUrl: process.env.STELLAR_IRC_URL || '/irc',
  disabledChannel: process.env.STELLAR_DISABLED_CHANNEL || '#disabled',
  staffPmPath: process.env.STELLAR_STAFFPM_PATH || '/inbox/staff',
  publicKbBase: process.env.STELLAR_PUBLIC_KB_BASE || 'https://korin.pink/wiki'
};

export const economy = {
  minimumBounty: parseInt(process.env.STELLAR_MINIMUM_BOUNTY || '104857600', 10)
};

export const ranks = {
  // Interval for the automated rank-progression sweep (USER_CLASSES_PLAN §6).
  // Default hourly — promotion is not time-critical and the sweep is read-heavy.
  progressionIntervalMs: parseInt(
    process.env.RANK_PROGRESSION_INTERVAL_MS ?? '3600000',
    10
  )
};

/**
 * Inactivity lifecycle (#279, ADR-0038). These are the operational dials only —
 * the thresholds themselves are constants in `modules/inactivity.ts`, because a
 * rule that disables member accounts should move by code review rather than by
 * environment variable.
 *
 * `mode` defaults to `off`. The first live run against an aged dataset is the
 * dangerous one, so the feature does nothing until someone deliberately turns it
 * on, and `dryRun` exists as a first-class state rather than as a logging
 * accident — it evaluates everything and applies nothing.
 *
 * `maxDisablesPerCycle` is the part that actually bounds the damage. A wrong
 * predicate cannot disable ten thousand accounts in one pass; the job runs daily,
 * so a legitimate backlog drains on its own while a mistake stays small enough to
 * notice and undo.
 */
export const inactivity = {
  mode: (['off', 'dryRun', 'on'] as const).includes(
    process.env.INACTIVITY_MODE as 'off' | 'dryRun' | 'on'
  )
    ? (process.env.INACTIVITY_MODE as 'off' | 'dryRun' | 'on')
    : ('off' as const),
  maxDisablesPerCycle: parseInt(
    process.env.INACTIVITY_MAX_DISABLES_PER_CYCLE ?? '50',
    10
  ),
  intervalMs: parseInt(process.env.INACTIVITY_INTERVAL_MS ?? '86400000', 10)
};

export const sentry = {
  dsn: process.env.STELLAR_SENTRY_DSN ?? ''
};

export const korin = {
  apiUrl: process.env.KORIN_API_URL ?? '',
  // Key stellar presents to korin on outbound calls (metrics pull + announce
  // push), sent as the `x-pull-key` header.
  pullKey: process.env.KORIN_PULL_KEY ?? '',
  pollIntervalMs: parseInt(process.env.KORIN_POLL_INTERVAL_MS ?? '300000', 10), // 5 min
  // Bearer key korin presents on its INBOUND service calls to stellar
  // (by-irc-nick lookup, link-nick, reputation-by-id). Fails closed when unset
  // — the korin-facing endpoints reject all requests (ADR-0013 contract).
  serviceKey: process.env.STELLAR_SERVICE_KEY ?? '',
  // Per-channel weights for the IRCScore channelQuality factor (#141). Values
  // stay DEFERRED until real multi-channel traffic exists (PRD-02); the default
  // empty map is behaviour-identical to unweighted channel counting. Format:
  // JSON object of `{ "#channel": weight }`, e.g. `{"#announce":0.2,"#help":1.5}`.
  channelWeights: parseChannelWeights(process.env.KORIN_CHANNEL_WEIGHTS)
};

// Binary asset store (ADR-0026). The backend is a Postgres `Bytes` column, so
// there is no connection to surface here — the only operational knob is the
// store-time size ceiling, enforced by `validateAsset`.
export const assets = {
  maxBytes: parseInt(process.env.STELLAR_ASSET_MAX_BYTES ?? '2000000', 10) // 2 MB
};

export const email = {
  smtpHost: process.env.STELLAR_SMTP_HOST ?? '',
  smtpPort: parseInt(process.env.STELLAR_SMTP_PORT ?? '587', 10),
  smtpUser: process.env.STELLAR_SMTP_USER ?? '',
  smtpPass: process.env.STELLAR_SMTP_PASS ?? '',
  fromAddress: process.env.STELLAR_SMTP_FROM ?? 'noreply@stellar.local',
  siteUrl: process.env.STELLAR_SITE_URL ?? 'http://localhost:3000'
};
