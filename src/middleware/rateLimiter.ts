import rateLimit from 'express-rate-limit';

const createLimiter = (windowMs: number, max: number, msg: string) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { msg }
  });

export const authLimiter = createLimiter(
  15 * 60 * 1000,
  20,
  'Too many requests, please try again later'
);

export const installLimiter = createLimiter(
  60 * 60 * 1000,
  5,
  'Too many install attempts, please try again later'
);

export const writeLimiter = createLimiter(
  60 * 1000,
  30,
  'Too many requests, please slow down'
);
