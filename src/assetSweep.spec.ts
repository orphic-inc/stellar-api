/**
 * Unit tests for the asset orphan sweep (ADR-0026 Phase 2, #342). Reference
 * extraction is pure and tested directly; the sweep runs against a mocked Prisma
 * so the delete predicate — owned, past grace, unreferenced — is pinned exactly,
 * since the failure mode of getting it wrong is deleting a live asset.
 */
import { mockDeep, mockReset } from 'jest-mock-extended';
import type { PrismaClient } from '@prisma/client';

const prismaMock = mockDeep<PrismaClient>();
jest.mock('./lib/prisma', () => ({ prisma: prismaMock }));

import {
  extractAssetHashes,
  collectReferencedHashes,
  sweepOrphanedAssets,
  GRACE_MS
} from './modules/assetSweep';

beforeEach(() => mockReset(prismaMock));

const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
const H3 = 'c'.repeat(64);

describe('extractAssetHashes', () => {
  it('pulls every /api/asset/<sha256> address out of a blob of text', () => {
    const css = `.a{background:url(/api/asset/${H1})}.b{background:url('/api/asset/${H2}')}`;
    expect(extractAssetHashes(css)).toEqual([H1, H2]);
  });

  it('is empty for null and for text with no references', () => {
    expect(extractAssetHashes(null)).toEqual([]);
    expect(extractAssetHashes('.a{color:red}')).toEqual([]);
  });

  it('ignores a malformed address (not 64 hex chars)', () => {
    expect(extractAssetHashes('/api/asset/tooshort')).toEqual([]);
    expect(extractAssetHashes(`/api/asset/${'a'.repeat(63)}`)).toEqual([]);
  });
});

describe('collectReferencedHashes', () => {
  it('unions references across stylesheet sources', async () => {
    prismaMock.authorStylesheet.findMany.mockResolvedValue([
      { source: `body{background:url(/api/asset/${H1})}` },
      {
        source: `a{background:url(/api/asset/${H2})}.b{background:url(/api/asset/${H1})}`
      }
    ] as never);

    const refs = await collectReferencedHashes();

    // H1 appears twice across sheets — the set dedupes it.
    expect(refs).toEqual(new Set([H1, H2]));
  });
});

describe('sweepOrphanedAssets', () => {
  const noReferences = () =>
    prismaMock.authorStylesheet.findMany.mockResolvedValue([] as never);

  it('deletes an owned, aged, unreferenced asset', async () => {
    noReferences();
    prismaMock.asset.findMany.mockResolvedValue([{ hash: H1 }] as never);
    prismaMock.asset.deleteMany.mockResolvedValue({ count: 1 } as never);

    const collected = await sweepOrphanedAssets();

    expect(collected).toBe(1);
    expect(prismaMock.asset.deleteMany).toHaveBeenCalledWith({
      where: { hash: { in: [H1] } }
    });
  });

  it('only considers owned assets past the grace window', async () => {
    noReferences();
    prismaMock.asset.findMany.mockResolvedValue([] as never);

    await sweepOrphanedAssets();

    const where = prismaMock.asset.findMany.mock.calls[0][0]!.where as {
      ownerId: unknown;
      createdAt: { lt: Date };
    };
    expect(where.ownerId).toEqual({ not: null });
    const ageMs = Date.now() - where.createdAt.lt.getTime();
    expect(Math.abs(ageMs - GRACE_MS)).toBeLessThan(5000);
  });

  it('spares a referenced asset even when it is owned and aged', async () => {
    prismaMock.authorStylesheet.findMany.mockResolvedValue([
      { source: `body{background:url(/api/asset/${H1})}` }
    ] as never);
    prismaMock.asset.findMany.mockResolvedValue([
      { hash: H1 }, // referenced
      { hash: H2 } // orphan
    ] as never);
    prismaMock.asset.deleteMany.mockResolvedValue({ count: 1 } as never);

    await sweepOrphanedAssets();

    expect(prismaMock.asset.deleteMany).toHaveBeenCalledWith({
      where: { hash: { in: [H2] } }
    });
  });

  it('deletes nothing when every candidate is referenced', async () => {
    prismaMock.authorStylesheet.findMany.mockResolvedValue([
      {
        source: `a{background:url(/api/asset/${H1})}b{background:url(/api/asset/${H3})}`
      }
    ] as never);
    prismaMock.asset.findMany.mockResolvedValue([
      { hash: H1 },
      { hash: H3 }
    ] as never);

    const collected = await sweepOrphanedAssets();

    expect(collected).toBe(0);
    expect(prismaMock.asset.deleteMany).not.toHaveBeenCalled();
  });

  it('loads only hashes, never the byte payloads it is trying to reclaim', async () => {
    noReferences();
    prismaMock.asset.findMany.mockResolvedValue([] as never);

    await sweepOrphanedAssets();

    expect(prismaMock.asset.findMany.mock.calls[0][0]!.select).toEqual({
      hash: true
    });
  });
});
