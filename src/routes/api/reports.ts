import express from 'express';
import { z } from 'zod';
import { authHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { requirePermission, isModerator } from '../../middleware/permissions';
import {
  validate,
  validateParams,
  validateQuery,
  parsedBody,
  parsedParams,
  parsedQuery
} from '../../middleware/validate';
import {
  fileReportSchema,
  resolveReportSchema,
  addNoteSchema,
  reportListQuerySchema,
  type FileReportInput,
  type ResolveReportInput,
  type AddNoteInput,
  type ReportListQueryInput
} from '../../schemas/reports';
import {
  fileReport,
  listReports,
  getReport,
  claimReport,
  unclaimReport,
  resolveReport,
  addNote,
  listMyReports,
  getReportCounts
} from '../../modules/reports';
import type { ReportTargetType, ReportStatus } from '@prisma/client';

const router = express.Router();

const reportIdSchema = z.object({
  id: z.coerce.number().int().positive()
});

// GET /api/reports/counts — open + claimed counts (staff)
router.get(
  '/counts',
  ...requirePermission('staff', 'admin'),
  authHandler(async (_req, res) => {
    const counts = await getReportCounts();
    res.json(counts);
  })
);

// GET /api/reports/mine — user's own submitted reports
router.get(
  '/mine',
  requireAuth,
  validateQuery(z.object({ page: z.coerce.number().int().min(1).default(1) })),
  authHandler(async (req, res) => {
    const { page } = parsedQuery<{ page: number }>(res);
    const result = await listMyReports(req.user.id, page);
    res.json(result);
  })
);

// GET /api/reports — staff queue
router.get(
  '/',
  ...requirePermission('staff', 'admin'),
  validateQuery(reportListQuerySchema),
  authHandler(async (req, res) => {
    const { page, status, targetType, claimedByMe } =
      parsedQuery<ReportListQueryInput>(res);
    const result = await listReports({
      page,
      status: status as ReportStatus | 'all',
      targetType: targetType as ReportTargetType | 'all',
      claimedByMe,
      staffUserId: req.user.id
    });
    res.json(result);
  })
);

// POST /api/reports — file a report (any authenticated user)
router.post(
  '/',
  requireAuth,
  validate(fileReportSchema),
  authHandler(async (req, res) => {
    const { targetType, targetId, category, reason, evidence } =
      parsedBody<FileReportInput>(res);
    const result = await fileReport(
      req.user.id,
      targetType as ReportTargetType,
      targetId,
      category,
      reason,
      evidence
    );
    res.status(201).json(result.report);
  })
);

// GET /api/reports/:id — view a report
router.get(
  '/:id',
  requireAuth,
  validateParams(reportIdSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const isStaff = await isModerator(req, res);
    const result = await getReport(id, req.user.id, isStaff);
    if (!result.ok) {
      if (result.reason === 'forbidden')
        return res.status(403).json({ msg: 'Permission denied' });
      return res.status(404).json({ msg: 'Report not found' });
    }
    res.json(result.report);
  })
);

// POST /api/reports/:id/claim — claim a report (staff)
router.post(
  '/:id/claim',
  ...requirePermission('staff', 'admin'),
  validateParams(reportIdSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const result = await claimReport(id, req.user.id);
    if (!result.ok) {
      const statusMap: Record<string, number> = {
        not_found: 404,
        resolved: 422,
        already_claimed: 409
      };
      return res
        .status(statusMap[result.reason] ?? 400)
        .json({ msg: result.reason });
    }
    res.status(204).send();
  })
);

// POST /api/reports/:id/unclaim — unclaim a report (staff)
router.post(
  '/:id/unclaim',
  ...requirePermission('staff', 'admin'),
  validateParams(reportIdSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const result = await unclaimReport(id, req.user.id);
    if (!result.ok) {
      const statusMap: Record<string, number> = {
        not_found: 404,
        not_claimed: 422,
        forbidden: 403
      };
      return res
        .status(statusMap[result.reason] ?? 400)
        .json({ msg: result.reason });
    }
    res.status(204).send();
  })
);

// POST /api/reports/:id/resolve — resolve a report (staff)
router.post(
  '/:id/resolve',
  ...requirePermission('staff', 'admin'),
  validateParams(reportIdSchema),
  validate(resolveReportSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { resolution, resolutionAction } =
      parsedBody<ResolveReportInput>(res);
    const result = await resolveReport(
      id,
      req.user.id,
      resolution,
      resolutionAction
    );
    if (!result.ok) {
      const statusMap: Record<string, number> = {
        not_found: 404,
        already_resolved: 422
      };
      return res
        .status(statusMap[result.reason] ?? 400)
        .json({ msg: result.reason });
    }
    res.status(204).send();
  })
);

// POST /api/reports/:id/notes — add a moderator note (staff)
router.post(
  '/:id/notes',
  ...requirePermission('staff', 'admin'),
  validateParams(reportIdSchema),
  validate(addNoteSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { body } = parsedBody<AddNoteInput>(res);
    const result = await addNote(id, req.user.id, body);
    if (!result.ok) {
      return res.status(404).json({ msg: 'Report not found' });
    }
    res.status(201).json(result.note);
  })
);

export default router;
