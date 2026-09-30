/**
 * Unit tests for putAsset's site-owned promotion racing the sweep (#843). The
 * client is injected; the database reproduction is in assetStore.integration.ts.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { putAsset } from './assetStore';

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fixture')
]);

const knownError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError(code, {
    code,
    clientVersion: 'test'
  });

const clientWith = (update: jest.Mock, create: jest.Mock) =>
  ({
    asset: {
      findUnique: async () => ({ hash: 'h', ownerId: 7 }),
      update,
      create
    }
  }) as unknown as PrismaClient;

describe('putAsset promoting a member-owned row', () => {
  it('stores the fixture afresh when the sweep took the row first', async () => {
    const update = jest.fn().mockRejectedValue(knownError('P2025'));
    const create = jest.fn().mockResolvedValue({ hash: 'h', ownerId: null });

    await expect(
      putAsset({ data: png, kind: 'ThemeImage' }, clientWith(update, create))
    ).resolves.toEqual({ hash: 'h', ownerId: null });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ownerId: null })
    });
  });

  it('rethrows any other error from the promotion', async () => {
    const update = jest.fn().mockRejectedValue(new Error('connection lost'));
    const create = jest.fn();

    await expect(
      putAsset({ data: png, kind: 'ThemeImage' }, clientWith(update, create))
    ).rejects.toThrow('connection lost');
    expect(create).not.toHaveBeenCalled();
  });
});
