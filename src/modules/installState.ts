import { prisma } from '../lib/prisma';

let cached: boolean | null = null;

export const isInstalled = async (): Promise<boolean> => {
  if (cached === true) return true;
  // Requires both ranks (seeded automatically) AND at least one user (created
  // via /install). Checking only ranks caused false-positives after DB resets.
  const installed =
    (await prisma.userRank.count()) > 0 && (await prisma.user.count()) > 0;
  if (installed) cached = true;
  return installed;
};
