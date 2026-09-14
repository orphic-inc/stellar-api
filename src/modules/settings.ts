import { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma';
import type { UpdateSettingsInput } from '../schemas/settings';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * The `id: 1` singleton's create-shape. Exported because every writer of this
 * row must agree on it — `seedBadPasswords` stamps its marker here too, and on
 * a fresh database it is often the first writer of all.
 */
export const DEFAULTS = {
  id: 1,
  approvedDomains: [] as string[],
  // 'closed' until the admin deliberately opens registration (#332); the
  // install checklist reminds them to flip it at launch.
  registrationStatus: 'closed' as const,
  maxUsers: 7000,
  dismissedLaunchChecklist: [] as string[]
};

/**
 * A seat is an enabled account (#624, ADR-0040). Disabling one frees a seat and
 * re-enabling takes it back, so the dormancy sweep (#279) returns capacity. The
 * System user is `disabled`, so it never holds one.
 *
 * Takes a client so `registerUser` can count inside its locked transaction;
 * every other reader is best-effort and uses the default.
 */
export function countSeats(client: Tx = prisma) {
  return client.user.count({ where: { disabled: false } });
}

/**
 * Whether every seat under `maxUsers` is taken. Best-effort: nothing is locked,
 * so it answers "was full a moment ago". Only `registerUser` takes a seat, and
 * it re-checks under a lock rather than trusting this.
 */
export async function isSiteFull(maxUsers?: number) {
  const limit = maxUsers ?? (await getSettings()).maxUsers;
  return (await countSeats()) >= limit;
}

export async function getSettings() {
  return prisma.siteSettings.upsert({
    where: { id: 1 },
    create: DEFAULTS,
    update: {}
  });
}

export async function updateSettings(input: UpdateSettingsInput) {
  return prisma.siteSettings.upsert({
    where: { id: 1 },
    create: {
      ...DEFAULTS,
      ...input
    },
    update: input
  });
}

/**
 * Stamp the install transition. The single write that flips install state from
 * awaiting_setup → installed; runs inside POST /install's transaction so it
 * commits atomically with the SysOp it records. Idempotent on `id: 1`.
 */
export async function markInstalled(tx: Tx = prisma) {
  const installedAt = new Date();
  return tx.siteSettings.upsert({
    where: { id: 1 },
    create: { ...DEFAULTS, installedAt },
    update: { installedAt }
  });
}
