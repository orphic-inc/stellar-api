import 'dotenv/config';

export const auth = {
  jwtSecret: process.env.STELLAR_AUTH_JWT_SECRET
};

export const logging = {
  level: process.env.STELLAR_LOG_LEVEL || 'info',
  timestampFormat: process.env.STELLAR_LOG_TIME_FMT
};

export const mongo = {
  uri: process.env.STELLAR_MONGO_URI
};

export const http = {
  port: parseInt(process.env.STELLAR_HTTP_PORT || '8080', 10),
  corsOrigin: process.env.STELLAR_HTTP_CORS_ORIGIN
};
