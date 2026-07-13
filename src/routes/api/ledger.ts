import { Router } from 'express';
import { requireServiceKey } from '../../middleware/serviceAuth';
import { asyncHandler } from '../../modules/asyncHandler';
import { getLedgerSnapshot } from '../../modules/ledger';

const router = Router();

/**
 * GET /api/ledger/snapshot (ADR-0016 working-set-snapshot flow).
 *
 * korin pulls this on boot / reload to seed its hot working set, then advances it
 * with live consumption events. Bearer `STELLAR_SERVICE_KEY` via `requireServiceKey`
 * (fails closed when the key is unset) — so, like the other korin-facing service
 * endpoints (`/users/:id/reputation`, `by-irc-nick`), it is intentionally kept OUT
 * of the public OpenAPI contract. The payload shape lives in `getLedgerSnapshot`.
 */
router.get(
  '/snapshot',
  requireServiceKey,
  asyncHandler(async (_req, res) => {
    res.json(await getLedgerSnapshot());
  })
);

export default router;
