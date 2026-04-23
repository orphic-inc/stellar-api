import { prisma } from '../lib/prisma';

export const isInstalled = async (): Promise<boolean> => {
  return (await prisma.userRank.count()) > 0;
};
