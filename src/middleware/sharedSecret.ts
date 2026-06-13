import { Request, Response, NextFunction } from 'express';
import { secureCompare } from '../lib/secureCompare';
import { irc } from '../modules/config';

/**
 * Bearer-token gate against a configured shared secret (PRD-02). Fails closed:
 * if the expected secret is unset, every request is rejected, so the guarded
 * surface is inert until the stellar-compose stack provides it.
 */
export const requireSharedSecret =
  (getExpected: () => string) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const expected = getExpected();
    const header = req.headers.authorization ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : '';

    if (!expected || !provided || !secureCompare(provided, expected)) {
      res.status(401).json({ msg: 'Unauthorized' });
      return;
    }
    next();
  };

/** The announce/activity bot's scoped token (Golden Rule 5). */
export const requireBotToken = requireSharedSecret(() => irc.botToken);

/** Ergo's shared secret for the internal SASL-validate callback (ADR-0011). */
export const requireSaslSecret = requireSharedSecret(() => irc.saslSecret);
