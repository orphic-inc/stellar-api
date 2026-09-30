/**
 * Unit tests for the donor forum title write (#830). Prisma is mocked; the
 * empty-update upsert's lost insert race is exercised here, and the database
 * reproduction lives in memberSelfService.integration.ts.
 */
import { Prisma } from '@prisma/client';

const mockPrisma = {
  userDonorRank: { findFirst: jest.fn() },
  donorForumUsername: { upsert: jest.fn() }
};

jest.mock('../lib/prisma', () => ({ prisma: mockPrisma }));
jest.mock('../lib/sanitize', () => ({
  sanitizePlain: (value: string) => value
}));
jest.mock('./remoteImage', () => ({
  registerWriteImages: () => Promise.resolve()
}));

import { updateDonorForumTitle } from './donor';

const knownError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError(code, {
    code,
    clientVersion: 'test'
  });

const row = { prefix: 'Dr.', suffix: '', useComma: false };

beforeEach(() => {
  mockPrisma.userDonorRank.findFirst.mockResolvedValue({
    donorRank: { perks: { forumTitle: true } }
  });
});

describe('updateDonorForumTitle', () => {
  it('retries once when a concurrent first write won the insert', async () => {
    mockPrisma.donorForumUsername.upsert
      .mockRejectedValueOnce(knownError('P2002'))
      .mockResolvedValueOnce({ id: 1, userId: 7, ...row });

    await expect(updateDonorForumTitle(7, {})).resolves.toEqual(row);
    expect(mockPrisma.donorForumUsername.upsert).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry also meets the key', async () => {
    mockPrisma.donorForumUsername.upsert.mockRejectedValue(knownError('P2002'));

    await expect(updateDonorForumTitle(7, {})).rejects.toMatchObject({
      code: 'P2002'
    });
    expect(mockPrisma.donorForumUsername.upsert).toHaveBeenCalledTimes(2);
  });

  it('does not retry any other error', async () => {
    mockPrisma.donorForumUsername.upsert.mockRejectedValue(knownError('P2003'));

    await expect(updateDonorForumTitle(7, {})).rejects.toMatchObject({
      code: 'P2003'
    });
    expect(mockPrisma.donorForumUsername.upsert).toHaveBeenCalledTimes(1);
  });
});
