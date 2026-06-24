import { Router, Request, Response } from 'express';
import { appVersion } from '../../lib/version';

// GET /api/version — the running platform version, inside the `/api` boundary so
// UI clients (which only proxy `/api`) can reach it. Distinct from root `/health`
// (a liveness probe, unreachable through the UI proxy). Mounted before the
// install gate: build info is install-independent and never sensitive.
const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json({ version: appVersion });
});

export default router;
