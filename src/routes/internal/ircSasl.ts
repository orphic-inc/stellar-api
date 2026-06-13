/**
 * INTERNAL — delegated IRC SASL validation (ADR-0011).
 *
 * This router is a new trust boundary. It MUST NOT be mounted under the public
 * `/api` surface, and in the stellar-compose stack it is reachable only over
 * the internal network, never the public ingress. It is guarded by Ergo's
 * shared secret (fails closed when unset) and rate-limited.
 */
import express from 'express';
import { asyncHandler } from '../../modules/asyncHandler';
import { requireSaslSecret } from '../../middleware/sharedSecret';
import { saslLimiter } from '../../middleware/rateLimiter';
import { validate, parsedBody } from '../../middleware/validate';
import { saslValidateSchema, type SaslValidateInput } from '../../schemas/irc';
import { validateSasl } from '../../modules/ircAuth';

const router = express.Router();

// POST /internal/irc/sasl — Ergo's per-login auth callback. Returns
// { ok: true, userId } on success, 403 { ok: false } on rejection.
router.post(
  '/sasl',
  saslLimiter,
  requireSaslSecret,
  validate(saslValidateSchema),
  asyncHandler(async (_req, res) => {
    const { account, password } = parsedBody<SaslValidateInput>(res);
    const result = await validateSasl(account, password);
    if (!result.ok) {
      res.status(403).json({ ok: false });
      return;
    }
    res.json({ ok: true, userId: result.userId });
  })
);

export default router;
