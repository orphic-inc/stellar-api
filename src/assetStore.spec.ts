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
  getOwnedAssetCount,
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
        ownerId: null
      }
    });
  });

  it('is idempotent by content: a repeat site-owned put returns the existing row', async () => {
    // What makes seeding safe to re-run on every container boot.
    const existing = { id: 7, hash: PNG_HASH, ownerId: null } as never;
    prismaMock.asset.findUnique.mockResolvedValue(existing);

    const result = await putAsset({ data: PNG, kind: 'ThemeImage' });

    expect(result).toBe(existing);
    expect(prismaMock.asset.create).not.toHaveBeenCalled();
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

  it('promotes a member-owned row to site-owned when the seeder collides with it', async () => {
    // A member uploaded bytes byte-identical to a shipped fixture; the seeder
    // (no ownerId) then stores the same bytes. The asset IS the fixture, so it
    // becomes site-owned — unauthenticated-servable, sweep-exempt, off the
    // member's quota.
    const existing = { id: 7, hash: PNG_HASH, ownerId: 42 } as never;
    prismaMock.asset.findUnique.mockResolvedValue(existing);
    prismaMock.asset.update.mockResolvedValue({
      id: 7,
      ownerId: null
    } as never);

    await putAsset({ data: PNG, kind: 'ThemeImage' });

    expect(prismaMock.asset.update).toHaveBeenCalledWith({
      where: { hash: PNG_HASH },
      data: { ownerId: null }
    });
  });

  it('does not touch ownership when a member put collides with their own row', async () => {
    const existing = { id: 7, hash: PNG_HASH, ownerId: 42 } as never;
    prismaMock.asset.findUnique.mockResolvedValue(existing);

    const result = await putAsset({
      data: PNG,
      kind: 'ThemeImage',
      ownerId: 42
    });

    expect(result).toBe(existing);
    expect(prismaMock.asset.update).not.toHaveBeenCalled();
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
  const stored = { id: 5, hash: PNG_HASH, ownerId: 42 } as never;

  it('stores an image under the caller when within the count limit', async () => {
    prismaMock.asset.findFirst.mockResolvedValue(null); // not already owned
    prismaMock.asset.count.mockResolvedValue(2);
    prismaMock.asset.findUnique.mockResolvedValue(null);
    prismaMock.asset.create.mockResolvedValue(stored);

    const result = await uploadAsset({
      data: PNG,
      kind: 'ThemeImage',
      ownerId: 42,
      assetLimit: 6
    });

    expect(result).toBe(stored);
    expect(prismaMock.asset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ownerId: 42 })
      })
    );
  });

  it('rejects when the rank cannot upload (limit 0)', async () => {
    await expect(
      uploadAsset({ data: PNG, kind: 'ThemeImage', ownerId: 42, assetLimit: 0 })
    ).rejects.toThrow(/cannot upload/);
    expect(prismaMock.asset.count).not.toHaveBeenCalled();
    expect(prismaMock.asset.create).not.toHaveBeenCalled();
  });

  it('rejects when the count limit is already reached', async () => {
    prismaMock.asset.findFirst.mockResolvedValue(null);
    prismaMock.asset.count.mockResolvedValue(6);

    await expect(
      uploadAsset({ data: PNG, kind: 'ThemeImage', ownerId: 42, assetLimit: 6 })
    ).rejects.toThrow(/limit reached/);
    expect(prismaMock.asset.create).not.toHaveBeenCalled();
  });

  it('does not charge for re-uploading bytes the member already owns', async () => {
    prismaMock.asset.findFirst.mockResolvedValue({ id: 5 } as never);
    prismaMock.asset.findUnique.mockResolvedValue(stored);

    await uploadAsset({
      data: PNG,
      kind: 'ThemeImage',
      ownerId: 42,
      assetLimit: 1 // absurdly low, but the owned check short-circuits it
    });

    expect(prismaMock.asset.count).not.toHaveBeenCalled();
  });

  it('never checks a quota when the rank is unlimited (null)', async () => {
    prismaMock.asset.findUnique.mockResolvedValue(null);
    prismaMock.asset.create.mockResolvedValue(stored);

    await uploadAsset({
      data: PNG,
      kind: 'ThemeImage',
      ownerId: 42,
      assetLimit: null
    });

    expect(prismaMock.asset.count).not.toHaveBeenCalled();
    expect(prismaMock.asset.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a font even under an unlimited rank (fonts stay seeder-only)', async () => {
    // A woff2 payload validates in the store's allowlist but must not reach it
    // through the member upload path — the #343 redistribution boundary.
    const WOFF2 = Buffer.concat([
      Buffer.from([0x77, 0x4f, 0x46, 0x32]),
      Buffer.from('font bytes')
    ]);

    await expect(
      uploadAsset({
        data: WOFF2,
        kind: 'ThemeImage',
        ownerId: 42,
        assetLimit: null
      })
    ).rejects.toThrow(/Only images/);
    expect(prismaMock.asset.create).not.toHaveBeenCalled();
  });

  it('rejects a non-image (unsupported) payload as a bad file, before counting', async () => {
    await expect(
      uploadAsset({
        data: Buffer.from('not an image'),
        kind: 'ThemeImage',
        ownerId: 42,
        assetLimit: 6
      })
    ).rejects.toThrow(AppError);
    expect(prismaMock.asset.count).not.toHaveBeenCalled();
  });
});

describe('getOwnedAssetCount', () => {
  it('counts the caller-owned rows', async () => {
    prismaMock.asset.count.mockResolvedValue(3);

    expect(await getOwnedAssetCount(42)).toBe(3);
    expect(prismaMock.asset.count).toHaveBeenCalledWith({
      where: { ownerId: 42 }
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
