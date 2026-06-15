import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { korin } from '../modules/config';

/**
 * Bearer service-key gate for korin.pink's inbound calls (ADR-0013 contract):
 * `GET /api/users/by-irc-nick/:nick`, `GET /api/users/:id/reputation`, and the
 * nick-link write. korin presents `Authorization: Bearer <STELLAR_SERVICE_KEY>`.
 *
 * Fails closed: if `STELLAR_SERVICE_KEY` is unset the gate rejects everything,
 * so the korin-facing surface is inert until the deploy provides the secret.
 */
const safeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
};

export const requireServiceKey = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const expected = korin.serviceKey;
  const header = req.header('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!expected || !presented || !safeEqual(presented, expected)) {
    res.status(401).json({ msg: 'Unauthorized' });
    return;
  }
  next();
};
