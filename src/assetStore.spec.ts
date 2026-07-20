/**
 * Unit tests for the content-addressed asset store (ADR-0026, #290). Prisma is
 * mocked; `hashAsset` and the real `validateAsset` run for real, so these also
 * pin that nothing unvalidated reaches the table.
 */

import { mockDeep, mockReset } from 'jest-mock-extended';
import type { PrismaClient } from '@prisma/client';

const prismaMock = mockDeep<PrismaClient>();
jest.mock('./lib/prisma', () => ({ prisma: prismaMock }));

import { AppError } from './lib/errors';
import {
  assetUrl,
  getAssetByHash,
  hashAsset,
  putAsset
} from './modules/assetStore';

beforeEach(() => mockReset(prismaMock));

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('proton background')
]);

// sha256 of PNG, computed by the module under test — asserted stable below.
const PNG_HASH = hashAsset(PNG);

describe('hashAsset', () => {
  it('is a 64-char sha256 hex digest', () => {
    expect(PNG_HASH).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across calls and sensitive to a single byte', () => {
    expect(hashAsset(PNG)).toBe(PNG_HASH);
    const altered = Buffer.from(PNG);
    altered[altered.length - 1] ^= 0x01;
    expect(hashAsset(altered)).not.toBe(PNG_HASH);
  });
});

describe('putAsset', () => {
  it('stores a validated payload under its content address', async () => {
    prismaMock.asset.findUnique.mockResolvedValue(null);
    prismaMock.asset.create.mockResolvedValue({ id: 1 } as never);

    await putAsset({ data: PNG, kind: 'ThemeImage' });

    expect(prismaMock.asset.create).toHaveBeenCalledWith({
      data: {
        hash: PNG_HASH,
        mime: 'image/png',
        size: PNG.length,
        kind: 'ThemeImage',
        data: PNG,
        ownerId: null
      }
    });
  });

  it('is idempotent by content: a repeat put returns the existing row', async () => {
    // What makes seeding safe to re-run on every container boot.
    const existing = { id: 7, hash: PNG_HASH } as never;
    prismaMock.asset.findUnique.mockResolvedValue(existing);

    const result = await putAsset({ data: PNG, kind: 'ThemeImage' });

    expect(result).toBe(existing);
    expect(prismaMock.asset.create).not.toHaveBeenCalled();
  });

  it('records an owner when one is given', async () => {
    prismaMock.asset.findUnique.mockResolvedValue(null);
    prismaMock.asset.create.mockResolvedValue({ id: 2 } as never);

    await putAsset({ data: PNG, kind: 'ThemeImage', ownerId: 42 });

    expect(prismaMock.asset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ownerId: 42 })
      })
    );
  });

  it('rejects an unvalidated payload without touching the table', async () => {
    await expect(
      putAsset({ data: Buffer.from('not an image'), kind: 'ThemeImage' })
    ).rejects.toThrow(AppError);
    expect(prismaMock.asset.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.asset.create).not.toHaveBeenCalled();
  });

  it('rejects a payload whose declared mime contradicts its bytes', async () => {
    await expect(
      putAsset({ data: PNG, mime: 'font/woff2', kind: 'ThemeFont' })
    ).rejects.toThrow(/image\/png/);
    expect(prismaMock.asset.create).not.toHaveBeenCalled();
  });
});

describe('getAssetByHash', () => {
  it('looks the row up by content address', async () => {
    prismaMock.asset.findUnique.mockResolvedValue({ id: 3 } as never);

    await getAssetByHash(PNG_HASH);

    expect(prismaMock.asset.findUnique).toHaveBeenCalledWith({
      where: { hash: PNG_HASH }
    });
  });
});

describe('assetUrl', () => {
  it('builds the public serve path', () => {
    expect(assetUrl(PNG_HASH)).toBe(`/api/asset/${PNG_HASH}`);
  });

  it('is scheme-less and same-origin, so the CSS validator accepts it', () => {
    // Pins the property the proton fixture depends on (cssValidate url allowlist,
    // ADR-0031 §3: relative paths only, every scheme and `data:` rejected).
    expect(assetUrl(PNG_HASH).startsWith('/')).toBe(true);
    expect(assetUrl(PNG_HASH).startsWith('//')).toBe(false);
  });
});
