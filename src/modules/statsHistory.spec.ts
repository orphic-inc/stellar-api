/**
 * Unit tests for captureSiteStats' lost insert (#844). Prisma is mocked; the
 * database reproduction is in statsHistory.integration.ts.
 */
import { Prisma } from '@prisma/client';

jest.mock('../lib/prisma', () => ({
  prisma: { siteStatSnapshot: { upsert: jest.fn() } }
}));
jest.mock('./stats', () => ({
  getSystemStats: () => Promise.resolve({ totalUsers: 1 })
}));

import { prisma } from '../lib/prisma';
import { captureSiteStats } from './statsHistory';

const upsert = prisma.siteStatSnapshot.upsert as unknown as jest.Mock;

const knownError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError(code, {
    code,
    clientVersion: 'test'
  });

describe('captureSiteStats', () => {
  it('treats a bucket another capture inserted first as captured', async () => {
    upsert.mockRejectedValue(knownError('P2002'));
    await expect(captureSiteStats()).resolves.toBeUndefined();
  });

  it('rethrows any other error', async () => {
    upsert.mockRejectedValue(knownError('P2003'));
    await expect(captureSiteStats()).rejects.toMatchObject({ code: 'P2003' });
  });
});
