import express from 'express';
import { z } from 'zod';
import { authHandler } from '../../modules/asyncHandler';
import { requirePermission } from '../../middleware/permissions';
import {
  validate,
  validateParams,
  parsedBody,
  parsedParams
} from '../../middleware/validate';
import {
  createResponseSchema,
  updateResponseSchema,
  type CreateResponseInput,
  type UpdateResponseInput
} from '../../schemas/staffInbox';
import {
  listResponses,
  createResponse,
  updateResponse,
  deleteResponse
} from '../../modules/staffInbox';

const router = express.Router();

const responseIdSchema = z.object({
  id: z.coerce.number().int().positive()
});

// GET /api/staff-inbox/responses — list canned responses (staff)
router.get(
  '/responses',
  ...requirePermission('staff', 'admin'),
  authHandler(async (_req, res) => {
    const responses = await listResponses();
    res.json(responses);
  })
);

// POST /api/staff-inbox/responses — create canned response (staff)
router.post(
  '/responses',
  ...requirePermission('staff', 'admin'),
  validate(createResponseSchema),
  authHandler(async (_req, res) => {
    const { name, body } = parsedBody<CreateResponseInput>(res);
    const response = await createResponse(name, body);
    res.status(201).json(response);
  })
);

// PUT /api/staff-inbox/responses/:id — update canned response (staff)
router.put(
  '/responses/:id',
  ...requirePermission('staff', 'admin'),
  validateParams(responseIdSchema),
  validate(updateResponseSchema),
  authHandler(async (_req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const data = parsedBody<UpdateResponseInput>(res);
    const result = await updateResponse(id, data);
    if (!result.ok) return res.status(404).json({ msg: 'Response not found' });
    res.json(result.response);
  })
);

// DELETE /api/staff-inbox/responses/:id — delete canned response (staff)
router.delete(
  '/responses/:id',
  ...requirePermission('staff', 'admin'),
  validateParams(responseIdSchema),
  authHandler(async (_req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const result = await deleteResponse(id);
    if (!result.ok) return res.status(404).json({ msg: 'Response not found' });
    res.status(204).send();
  })
);

export default router;
