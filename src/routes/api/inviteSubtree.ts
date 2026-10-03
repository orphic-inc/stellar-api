import express from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { authHandler } from '../../modules/asyncHandler';
import {
  hasPermission,
  loadPermissions,
  requirePermission,
  type Permission
} from '../../middleware/permissions';
import { validate, validateParams } from '../../middleware/validate';
import {
  applyInviteSubtreeAction,
  previewInviteSubtree
} from '../../modules/inviteSubtree';
import {
  inviteSubtreeActionSchema,
  type InviteSubtreeAction
} from '../../schemas/inviteSubtree';

/**
 * Staff actions on a member's invite subtree (#639), mounted on the users
 * router. Each action needs the permission its single-member route needs, on
 * top of `invites_manage` for the tree, so the tool can do nothing to many
 * members that its user cannot do to one (ADR-0001).
 */
const router = express.Router();

const userIdParams = validateParams(
  z.object({ id: z.coerce.number().int().positive() })
);
const actionBody = validate(inviteSubtreeActionSchema);

const ACTION_PERMISSION: Record<InviteSubtreeAction, Permission> = {
  note: 'users_edit',
  disable: 'users_disable',
  revoke_invites: 'invites_edit'
};

// GET /api/users/:id/invite-subtree/preview — who an action would touch
router.get(
  '/:id/invite-subtree/preview',
  ...requirePermission('invites_manage'),
  userIdParams,
  authHandler(async (_req, res) => {
    const { id } = userIdParams.read(res);
    res.json(await previewInviteSubtree(id));
  })
);

// POST /api/users/:id/invite-subtree/action — apply one action to every descendant
router.post(
  '/:id/invite-subtree/action',
  ...requirePermission('invites_manage'),
  userIdParams,
  actionBody,
  authHandler(async (req, res) => {
    const { id } = userIdParams.read(res);
    const input = actionBody.read(res);
    const permission = ACTION_PERMISSION[input.action];
    if (!hasPermission(await loadPermissions(req, res), permission)) {
      throw new AppError(403, `This action needs the ${permission} permission`);
    }
    res.json(await applyInviteSubtreeAction(req.user.id, id, input));
  })
);

export default router;
