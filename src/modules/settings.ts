import { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma';
import type { UpdateSettingsInput } from '../schemas/settings';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

const DEFAULTS = {
  id: 1,
  approvedDomains: [] as string[],
  // 'closed' until the admin deliberately opens registration (#332); the
  // install checklist reminds them to flip it at launch.
  registrationStatus: 'closed' as const,
  maxUsers: 7000,
  dismissedLaunchChecklist: [] as string[]
};

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
