import { prisma } from '../lib/prisma';

// Cached in memory after first check so every API request doesn't hit the DB
let _installed: boolean | null = null;

export const isInstalled = async (): Promise<boolean> => {
  if (_installed === null) {
    _installed = (await prisma.userRank.count()) > 0;
  }
  return _installed;
};

export const markInstalled = (): void => {
  _installed = true;
};
