import { prisma } from '../lib/prisma';

let cached: boolean | null = null;

export const isInstalled = async (): Promise<boolean> => {
  if (cached === true) return true;
  const installed = (await prisma.userRank.count()) > 0;
  if (installed) cached = true;
  return installed;
};
