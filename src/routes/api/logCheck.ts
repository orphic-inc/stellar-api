import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { validate, parsedBody } from '../../middleware/validate';
import { authHandler } from '../../modules/asyncHandler';
import { checkLog } from '../../modules/logChecker';
import {
  logCheckRequestSchema,
  type LogCheckRequest
} from '../../schemas/logCheck';

// POST /api/log-check — score a pasted EAC/XLD rip log (0–100; 100 = verified
// perfect). Stateless: no DB, no side effects. Login-gated only — any contributor
// may check a log before contributing. The score is advisory in this phase; it is
// not persisted against a contribution (that wiring belongs to the CRS/grade work).
const router = Router();

router.post(
  '/',
  requireAuth,
  validate(logCheckRequestSchema),
  authHandler(async (_req, res) => {
    const { log } = parsedBody<LogCheckRequest>(res);
    res.json(checkLog(log));
  })
);

export default router;
