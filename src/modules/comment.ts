import { prisma } from '../lib/prisma';

export const deleteComment = async (
  id: number,
  actorId: number,
  isModAction: boolean
) =>
  prisma.$transaction([
    prisma.comment.update({ where: { id }, data: { deletedAt: new Date() } }),
    prisma.auditLog.create({
      data: {
        actorId,
        action: isModAction ? 'comment.mod_delete' : 'comment.delete',
        targetType: 'Comment',
        targetId: id
      }
    })
  ]);
