/**
 * routes/api/devTools.ts
 *
 * Developer-only API route for test data generation and cleanup.
 *
 * SAFETY:
 *   1. This entire router is only mounted when NODE_ENV !== 'production' (see app.ts).
 *   2. Every endpoint additionally checks NODE_ENV at runtime (belt-and-suspenders).
 *   3. All endpoints require 'admin' permission.
 *   4. Generated users always use @seed.invalid email TLD.
 *   5. Cleanup only deletes rows tracked in DevSeedRecord.
 *
 * Endpoints:
 *   GET  /api/dev/status            — environment info and run count
 *   GET  /api/dev/runs              — list DevSeedRun records
 *   GET  /api/dev/runs/:id          — single run detail
 *   POST /api/dev/estimate          — dry-run estimate (no writes)
 *   POST /api/dev/generate          — execute generation
 *   POST /api/dev/runs/:id/cleanup  — clean up one run
 *   POST /api/dev/cleanup-all       — clean up all runs
 */

import express, { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import { requirePermission } from '../../middleware/permissions';
import {
  validate,
  validateParams,
  parsedBody,
  parsedParams
} from '../../middleware/validate';
import {
  generateConfigSchema,
  runIdParamsSchema,
  type GenerateConfigInput
} from '../../schemas/devTools';
import {
  runGeneration,
  resolveConfig,
  estimateCounts
} from '../../modules/devTools/index';
import { cleanupRun } from '../../modules/devTools/cleanup';
import { getLogger } from '../../modules/logging';

const log = getLogger('devTools');
const router = express.Router();

// Belt-and-suspenders production guard on every request
router.use((_req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return res
      .status(403)
      .json({ msg: 'Dev tools are not available in production' });
  }
  next();
});

// ─── GET /api/dev/status ─────────────────────────────────────────────────────

router.get(
  '/status',
  ...requirePermission('admin'),
  asyncHandler(async (_req: Request, res: Response) => {
    const runCount = await prisma.devSeedRun.count();
    const jobsEnabled = process.env.DISABLE_BACKGROUND_JOBS !== '1';

    res.json({
      enabled: true,
      environment: process.env.NODE_ENV ?? 'development',
      runCount,
      jobsEnabled,
      warning: jobsEnabled
        ? 'Background jobs are active. Set DISABLE_BACKGROUND_JOBS=1 to prevent jobs from mutating generated data.'
        : null
    });
  })
);

// ─── GET /api/dev/runs ───────────────────────────────────────────────────────

router.get(
  '/runs',
  ...requirePermission('admin'),
  asyncHandler(async (_req: Request, res: Response) => {
    const runs = await prisma.devSeedRun.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        label: true,
        mode: true,
        config: true,
        summary: true,
        warnings: true,
        cleanupStatus: true,
        reversibilityLevel: true,
        actorId: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { records: true, mutations: true } }
      }
    });
    res.json(runs);
  })
);

// ─── GET /api/dev/runs/:id ───────────────────────────────────────────────────

router.get(
  '/runs/:id',
  ...requirePermission('admin'),
  validateParams(runIdParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = parsedParams<{ id: string }>(res);

    const run = await prisma.devSeedRun.findUnique({
      where: { id },
      include: {
        _count: { select: { records: true, mutations: true } }
      }
    });

    if (!run) return res.status(404).json({ msg: 'Seed run not found' });
    res.json(run);
  })
);

// ─── POST /api/dev/estimate ───────────────────────────────────────────────────

router.post(
  '/estimate',
  ...requirePermission('admin'),
  validate(generateConfigSchema),
  asyncHandler(async (_req: Request, res: Response) => {
    const body = parsedBody<GenerateConfigInput>(res);
    const config = resolveConfig(body);
    const counts = estimateCounts(config);

    const warnings: string[] = [];
    if (config.sections.has('forum') && config.mode === 'isolated') {
      warnings.push(
        'Forum generator requires integrated mode — will be skipped'
      );
    }

    res.json({
      counts,
      warnings,
      sections: [...config.sections],
      mode: config.mode
    });
  })
);

// ─── POST /api/dev/generate ───────────────────────────────────────────────────

router.post(
  '/generate',
  ...requirePermission('admin'),
  validate(generateConfigSchema),
  authHandler(async (req, res) => {
    const body = parsedBody<GenerateConfigInput>(res);

    log.info('Test data generation started', {
      actorId: req.user.id,
      preset: body.preset,
      mode: body.mode,
      scale: body.scale,
      dryRun: body.dryRun
    });

    const result = await runGeneration(body, req.user.id);

    log.info('Test data generation complete', {
      runId: result.runId,
      summary: result.summary,
      validationPassed: result.validation.passed,
      warnings: result.warnings.length
    });

    res.status(result.dryRun ? 200 : 201).json(result);
  })
);

// ─── POST /api/dev/runs/:id/cleanup ──────────────────────────────────────────

router.post(
  '/runs/:id/cleanup',
  ...requirePermission('admin'),
  validateParams(runIdParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: string }>(res);

    const run = await prisma.devSeedRun.findUnique({ where: { id } });
    if (!run) return res.status(404).json({ msg: 'Seed run not found' });

    log.info('Test data cleanup started', { runId: id, actorId: req.user.id });

    const result = await cleanupRun(prisma, id);

    log.info('Test data cleanup complete', {
      runId: id,
      status: result.status,
      failedCount: result.failedItems.length
    });

    res.json(result);
  })
);

// ─── POST /api/dev/cleanup-all ────────────────────────────────────────────────

router.post(
  '/cleanup-all',
  ...requirePermission('admin'),
  authHandler(async (req, res) => {
    const runs = await prisma.devSeedRun.findMany({
      where: { cleanupStatus: { in: ['active', 'partial', 'failed'] } },
      select: { id: true },
      orderBy: { createdAt: 'asc' }
    });

    log.info('Bulk test data cleanup started', {
      runCount: runs.length,
      actorId: req.user.id
    });

    const results = [];
    for (const run of runs) {
      const result = await cleanupRun(prisma, run.id);
      results.push(result);
    }

    // Delete the DevSeedRun records themselves for cleaned runs
    await prisma.devSeedRun.deleteMany({
      where: {
        id: {
          in: results.filter((r) => r.status === 'cleaned').map((r) => r.runId)
        }
      }
    });

    res.json({
      cleaned: results.filter((r) => r.status === 'cleaned').length,
      partial: results.filter((r) => r.status === 'partial').length,
      failed: results.filter((r) => r.status === 'failed').length,
      results
    });
  })
);

export default router;
