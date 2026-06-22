/**
 * devTools/tracking.ts
 *
 * Helpers to record created rows and shared-row mutations into
 * DevSeedRecord / DevSeedMutation so that cleanup is precise and safe.
 */

import { PrismaClient, Prisma } from '@prisma/client';

// Prisma transaction client type (the arg passed to $transaction callback)
type PrismaTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Record a newly created row.
 * pk must uniquely identify the row — e.g. { id: 7 } or { alias: 'foo' }
 * or { userId: 2, userRankId: 5 } for composite keys.
 */
export async function trackCreate(
  tx: PrismaTx,
  runId: string,
  entityType: string,
  pk: Record<string, unknown>
): Promise<void> {
  await tx.devSeedRecord.create({
    data: { runId, entityType, primaryKey: pk as Prisma.InputJsonValue }
  });
}

/**
 * Record a mutation to a pre-existing shared row so that cleanup can revert it.
 * Used in integrated mode when existing forums, tags, etc. are modified.
 *
 * @param reversible  Set false if the mutation cannot be safely reverted
 *                    (e.g. audit log entries, notification side effects).
 */
export async function trackMutation(
  tx: PrismaTx,
  runId: string,
  entityType: string,
  pk: Record<string, unknown>,
  before: unknown,
  after: unknown,
  mutation: string,
  reversible = true
): Promise<void> {
  await tx.devSeedMutation.create({
    data: {
      runId,
      entityType,
      primaryKey: pk as Prisma.InputJsonValue,
      before:
        before == null ? Prisma.DbNull : (before as Prisma.InputJsonValue),
      after: after == null ? Prisma.DbNull : (after as Prisma.InputJsonValue),
      mutation,
      reversible
    }
  });

  // If any mutation is not reversible, update the run's reversibilityLevel to 'partial'
  if (!reversible) {
    await tx.devSeedRun.update({
      where: { id: runId },
      data: { reversibilityLevel: 'partial' }
    });
  }
}

/**
 * Append a warning string to the run's warnings array.
 * Warnings are informational — they do not stop generation.
 */
export async function appendWarning(
  tx: PrismaTx,
  runId: string,
  message: string
): Promise<void> {
  const run = await tx.devSeedRun.findUnique({
    where: { id: runId },
    select: { warnings: true }
  });
  const existing = (run?.warnings as string[] | null) ?? [];
  await tx.devSeedRun.update({
    where: { id: runId },
    data: { warnings: [...existing, message] }
  });
}

/**
 * Bulk-track an array of created Int-ID rows of the same entity type.
 * More efficient than one call per row for high-volume generators.
 */
export async function trackManyCreated(
  tx: PrismaTx,
  runId: string,
  entityType: string,
  ids: number[]
): Promise<void> {
  if (ids.length === 0) return;
  await tx.devSeedRecord.createMany({
    data: ids.map((id) => ({ runId, entityType, primaryKey: { id } }))
  });
}

/**
 * Returns all DevSeedRecord rows for a run, grouped by entityType.
 */
export async function getTrackedRecords(
  prisma: PrismaClient,
  runId: string
): Promise<Map<string, unknown[]>> {
  const records = await prisma.devSeedRecord.findMany({ where: { runId } });
  const map = new Map<string, unknown[]>();
  for (const r of records) {
    const list = map.get(r.entityType) ?? [];
    list.push(r.primaryKey);
    map.set(r.entityType, list);
  }
  return map;
}

/**
 * Returns all DevSeedMutation rows for a run.
 */
export async function getTrackedMutations(
  prisma: PrismaClient,
  runId: string
): Promise<
  Array<{
    entityType: string;
    primaryKey: unknown;
    mutation: string;
    before: unknown;
    reversible: boolean;
  }>
> {
  return prisma.devSeedMutation.findMany({ where: { runId } });
}
