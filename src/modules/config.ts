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
