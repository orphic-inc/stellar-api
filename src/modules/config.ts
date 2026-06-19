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

export const auth = {
  jwtSecret: requireEnv('STELLAR_AUTH_JWT_SECRET', 32)
};

export const logging = {
  level: process.env.STELLAR_LOG_LEVEL || 'info',
  timestampFormat: process.env.STELLAR_LOG_TIME_FMT
};

export const http = {
  port: parseInt(process.env.STELLAR_HTTP_PORT || '8080', 10),
  corsOrigin: process.env.STELLAR_HTTP_CORS_ORIGIN || 'http://localhost:3000'
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
  serviceKey: process.env.STELLAR_SERVICE_KEY ?? ''
};

export const email = {
  smtpHost: process.env.STELLAR_SMTP_HOST ?? '',
  smtpPort: parseInt(process.env.STELLAR_SMTP_PORT ?? '587', 10),
  smtpUser: process.env.STELLAR_SMTP_USER ?? '',
  smtpPass: process.env.STELLAR_SMTP_PASS ?? '',
  fromAddress: process.env.STELLAR_SMTP_FROM ?? 'noreply@stellar.local',
  siteUrl: process.env.STELLAR_SITE_URL ?? 'http://localhost:3000'
};
