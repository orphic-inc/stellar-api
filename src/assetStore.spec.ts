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
  getOwnedAssetBytes,
  hashAsset,
  putAsset,
  uploadAsset
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
        ownerId: null,
        visibility: 'Members'
      }
    });
  });

  it('defaults to Members but stores Public when asked (the seeder path)', async () => {
    prismaMock.asset.findUnique.mockResolvedValue(null);
    prismaMock.asset.create.mockResolvedValue({ id: 9 } as never);

    await putAsset({ data: PNG, kind: 'ThemeImage', visibility: 'Public' });

    expect(prismaMock.asset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ visibility: 'Public' })
      })
    );
  });

  it('is idempotent by content: a repeat put returns the existing row', async () => {
    // What makes seeding safe to re-run on every container boot.
    const existing = {
      id: 7,
      hash: PNG_HASH,
      visibility: 'Members'
    } as never;
    prismaMock.asset.findUnique.mockResolvedValue(existing);

    const result = await putAsset({ data: PNG, kind: 'ThemeImage' });

    expect(result).toBe(existing);
    expect(prismaMock.asset.create).not.toHaveBeenCalled();
  });

  it('widens an existing row to Public on a dedup collision, never narrows', async () => {
    // A member's bytes collide with a to-be-seeded fixture, or the seeder
    // re-runs over a Members row: Public must win so logged-out delivery works.
    const existing = {
      id: 7,
      hash: PNG_HASH,
      visibility: 'Members'
    } as never;
    prismaMock.asset.findUnique.mockResolvedValue(existing);
    prismaMock.asset.update.mockResolvedValue({
      id: 7,
      visibility: 'Public'
    } as never);

    await putAsset({ data: PNG, kind: 'ThemeImage', visibility: 'Public' });

    expect(prismaMock.asset.update).toHaveBeenCalledWith({
      where: { hash: PNG_HASH },
      data: { visibility: 'Public' }
    });
  });

  it('does not narrow a Public row when a Members put collides with it', async () => {
    const existing = {
      id: 7,
      hash: PNG_HASH,
      visibility: 'Public'
    } as never;
    prismaMock.asset.findUnique.mockResolvedValue(existing);

    const result = await putAsset({ data: PNG, kind: 'ThemeImage' });

    expect(result).toBe(existing);
    expect(prismaMock.asset.update).not.toHaveBeenCalled();
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

describe('uploadAsset', () => {
  const asUploaded = { id: 5, hash: PNG_HASH } as never;

  it('charges the byte budget and stores when under it', async () => {
    prismaMock.asset.findFirst.mockResolvedValue(null); // not already owned
    prismaMock.asset.aggregate.mockResolvedValue({
      _sum: { size: 100 }
    } as never);
    prismaMock.asset.findUnique.mockResolvedValue(null);
    prismaMock.asset.create.mockResolvedValue(asUploaded);

    const result = await uploadAsset({
      data: PNG,
      kind: 'Avatar',
      ownerId: 42,
      assetByteLimit: 100000
    });

    expect(result).toBe(asUploaded);
    expect(prismaMock.asset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ownerId: 42, visibility: 'Members' })
      })
    );
  });

  it('rejects when the upload would exceed the byte budget', async () => {
    prismaMock.asset.findFirst.mockResolvedValue(null);
    prismaMock.asset.aggregate.mockResolvedValue({
      _sum: { size: 999_990 }
    } as never);

    await expect(
      uploadAsset({
        data: PNG,
        kind: 'Avatar',
        ownerId: 42,
        assetByteLimit: 1_000_000
      })
    ).rejects.toThrow(/storage limit/);
    expect(prismaMock.asset.create).not.toHaveBeenCalled();
  });

  it('does not charge for re-uploading bytes the member already owns', async () => {
    // Content-addressing means this stores nothing new; charging it would be
    // rent on a row that already exists.
    prismaMock.asset.findFirst.mockResolvedValue({ id: 5 } as never);
    prismaMock.asset.findUnique.mockResolvedValue(asUploaded);

    await uploadAsset({
      data: PNG,
      kind: 'Avatar',
      ownerId: 42,
      assetByteLimit: 1 // absurdly low, but the owned check short-circuits it
    });

    expect(prismaMock.asset.aggregate).not.toHaveBeenCalled();
  });

  it('validates before counting, so an oversize file reports as a bad file', async () => {
    await expect(
      uploadAsset({
        data: Buffer.from('not an image'),
        kind: 'Avatar',
        ownerId: 42,
        assetByteLimit: 1_000_000
      })
    ).rejects.toThrow(/Unsupported asset type/);
    expect(prismaMock.asset.aggregate).not.toHaveBeenCalled();
  });

  it('skips the budget check entirely when the limit is 0 (unlimited)', async () => {
    prismaMock.asset.findUnique.mockResolvedValue(null);
    prismaMock.asset.create.mockResolvedValue(asUploaded);

    await uploadAsset({
      data: PNG,
      kind: 'Avatar',
      ownerId: 42,
      assetByteLimit: 0
    });

    expect(prismaMock.asset.aggregate).not.toHaveBeenCalled();
    expect(prismaMock.asset.findFirst).not.toHaveBeenCalled();
  });
});

describe('getOwnedAssetBytes', () => {
  it('sums the owner rows and treats no rows as zero', async () => {
    prismaMock.asset.aggregate.mockResolvedValue({
      _sum: { size: null }
    } as never);

    expect(await getOwnedAssetBytes(42)).toBe(0);
    expect(prismaMock.asset.aggregate).toHaveBeenCalledWith({
      where: { ownerId: 42 },
      _sum: { size: true }
    });
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
