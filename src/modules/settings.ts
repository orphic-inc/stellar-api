import { prisma } from '../lib/prisma';
import type { UpdateSettingsInput } from '../schemas/settings';

const DEFAULTS = {
  id: 1,
  approvedDomains: [] as string[],
  registrationStatus: 'open' as const,
  maxUsers: 7000
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
