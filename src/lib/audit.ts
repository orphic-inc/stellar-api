import { Prisma, PrismaClient } from '@prisma/client';

type TxClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export const audit = (
  client: TxClient | PrismaClient,
  actorId: number,
  action: string,
  targetType: string,
  targetId?: number,
  metadata?: Record<string, unknown>
): Promise<unknown> =>
  (client as PrismaClient).auditLog.create({
    data: { actorId, action, targetType, targetId: targetId ?? null, metadata: metadata as Prisma.InputJsonValue ?? Prisma.JsonNull }
  });
