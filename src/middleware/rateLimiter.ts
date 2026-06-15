import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { getLogger } from '../modules/logging';

const secLog = getLogger('security');

const createLimiter = (windowMs: number, max: number, msg: string) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { msg },
    handler: (req: Request, res: Response, _next: NextFunction, options) => {
      secLog.warn('Rate limit exceeded', {
        ip: req.ip,
        method: req.method,
        path: req.path,
        limit: options.max,
        windowMs: options.windowMs
      });
      res.status(options.statusCode).json(options.message);
    }
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

export const downloadLimiter = createLimiter(
  60 * 1000,
  10,
  'Too many download requests, please slow down'
);
