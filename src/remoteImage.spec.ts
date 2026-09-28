/**
 * Unit tests for the remote image import (#737, ADR-0051): registration and its
 * ceiling, one import's outcomes, the leased batch, the render lookup, and the
 * walker over every image-bearing column. The fetch itself is `remoteFetch`'s
 * to test; here it is a stub returning whatever the case needs.
 */
import { mockDeep, mockReset } from 'jest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import type { RemoteFetchResult } from './lib/remoteFetch';

const prismaMock = mockDeep<PrismaClient>();
jest.mock('./lib/prisma', () => ({ prisma: prismaMock }));

// A plain function over a variable: resetMocks would strip a factory jest.fn.
let mockFetchResult: RemoteFetchResult = {
  ok: false,
  reason: 'unset',
  retryable: false
};
jest.mock('./lib/remoteFetch', () => ({
  fetchRemote: () => Promise.resolve(mockFetchResult)
}));

import {
  collectReferencedRemoteUrls,
  importRemoteImage,
  importedAssetUrls,
  processDueRemoteImages,
  registerBBCodeImages,
  registerRemoteImages
} from './modules/remoteImage';
import { AppError } from './lib/errors';
import { imageImport } from './modules/config';

const PNG = Buffer.concat([
  Buffer.from('89504e470d0a1a0a', 'hex'),
  Buffer.alloc(32, 1)
]);
const WOFF2 = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(32, 1)]);

beforeEach(() => {
  mockReset(prismaMock);
  mockFetchResult = { ok: false, reason: 'unset', retryable: false };
});

describe('registerRemoteImages', () => {
  it('queues each new importable URL once, for the requester', async () => {
    prismaMock.remoteImage.findMany.mockResolvedValue([
      { url: 'https://a.example/known.png' }
    ] as never);
    prismaMock.remoteImage.count.mockResolvedValue(0);
    prismaMock.remoteImage.createMany.mockResolvedValue({ count: 1 });

    const queued = await registerRemoteImages(
      [
        'https://a.example/known.png',
        ' https://a.example/new.png ',
        'https://a.example/new.png',
        'ftp://a.example/x.png',
        'not a url'
      ],
      7
    );

    expect(queued).toBe(1);
    expect(prismaMock.remoteImage.createMany).toHaveBeenCalledWith({
      data: [{ url: 'https://a.example/new.png', requestedById: 7 }],
      skipDuplicates: true
    });
  });

  it('refuses a write that would pass the daily ceiling, recording nothing', async () => {
    prismaMock.remoteImage.findMany.mockResolvedValue([] as never);
    prismaMock.remoteImage.count.mockResolvedValue(imageImport.dailyLimit - 1);

    const attempt = registerRemoteImages(
      ['https://a.example/1.png', 'https://a.example/2.png'],
      7
    );

    await expect(attempt).rejects.toBeInstanceOf(AppError);
    await expect(attempt).rejects.toMatchObject({ statusCode: 429 });
    expect(prismaMock.remoteImage.createMany).not.toHaveBeenCalled();
    // Counted over the requester's last 24 hours.
    const where = prismaMock.remoteImage.count.mock.calls[0][0]!.where as {
      requestedById: number;
      createdAt: { gt: Date };
    };
    expect(where.requestedById).toBe(7);
    const windowMs = Date.now() - where.createdAt.gt.getTime();
    expect(Math.abs(windowMs - 24 * 60 * 60 * 1000)).toBeLessThan(5000);
  });

  it('lets a member at the ceiling reuse an image already known', async () => {
    prismaMock.remoteImage.findMany.mockResolvedValue([
      { url: 'https://a.example/known.png' }
    ] as never);

    expect(await registerRemoteImages(['https://a.example/known.png'], 7)).toBe(
      0
    );
    expect(prismaMock.remoteImage.count).not.toHaveBeenCalled();
  });

  it('skips the ceiling for an exempt caller (the backfill)', async () => {
    prismaMock.remoteImage.findMany.mockResolvedValue([] as never);
    prismaMock.remoteImage.createMany.mockResolvedValue({ count: 2 });

    await registerRemoteImages(
      ['https://a.example/1.png', 'https://a.example/2.png'],
      7,
      { exempt: true }
    );

    expect(prismaMock.remoteImage.count).not.toHaveBeenCalled();
    expect(prismaMock.remoteImage.createMany).toHaveBeenCalled();
  });

  it('registers what a BBCode body would draw as images', async () => {
    prismaMock.remoteImage.findMany.mockResolvedValue([] as never);
    prismaMock.remoteImage.count.mockResolvedValue(0);
    prismaMock.remoteImage.createMany.mockResolvedValue({ count: 1 });

    await registerBBCodeImages(
      'look [img]https://a.example/x.png[/img] [code][img]https://a.example/no.png[/img][/code]',
      7
    );

    expect(prismaMock.remoteImage.createMany).toHaveBeenCalledWith({
      data: [{ url: 'https://a.example/x.png', requestedById: 7 }],
      skipDuplicates: true
    });
  });
});

describe('importRemoteImage', () => {
  const row = {
    id: 3,
    url: 'https://a.example/x.png',
    attempts: 0,
    requestedById: 7
  };

  it('stores the bytes as an Imported asset owned by the requester', async () => {
    mockFetchResult = { ok: true, data: PNG, finalUrl: row.url };
    prismaMock.asset.findUnique.mockResolvedValue(null);
    prismaMock.asset.create.mockImplementation(((args: {
      data: { hash: string };
    }) => Promise.resolve({ hash: args.data.hash })) as never);

    expect(await importRemoteImage(row)).toBe('imported');

    const created = prismaMock.asset.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      kind: 'Imported',
      ownerId: 7,
      mime: 'image/png'
    });
    expect(prismaMock.remoteImage.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: {
        attempts: 1,
        status: 'imported',
        reason: null,
        assetHash: created.hash
      }
    });
  });

  it('backs off a retryable failure', async () => {
    mockFetchResult = { ok: false, reason: 'timed out', retryable: true };

    expect(await importRemoteImage(row)).toBe('retry');

    const data = prismaMock.remoteImage.update.mock.calls[0][0].data as {
      attempts: number;
      reason: string;
      nextAttemptAt: Date;
      status?: unknown;
    };
    expect(data).toMatchObject({ attempts: 1, reason: 'timed out' });
    expect(data.status).toBeUndefined();
    const delay = data.nextAttemptAt.getTime() - Date.now();
    expect(delay).toBeGreaterThan(55_000);
    expect(delay).toBeLessThan(65_000);
  });

  it('fails for good once the retries are spent', async () => {
    mockFetchResult = { ok: false, reason: 'timed out', retryable: true };

    expect(await importRemoteImage({ ...row, attempts: 3 })).toBe('failed');
    expect(prismaMock.remoteImage.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { attempts: 4, status: 'failed', reason: 'timed out' }
    });
  });

  it('fails at once when the failure is final', async () => {
    mockFetchResult = {
      ok: false,
      reason: "address '10.0.0.1' is not publicly routable",
      retryable: false
    };

    expect(await importRemoteImage(row)).toBe('failed');
    expect(prismaMock.remoteImage.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: {
        attempts: 1,
        status: 'failed',
        reason: "address '10.0.0.1' is not publicly routable"
      }
    });
  });

  it('refuses bytes that are not an image, whatever the URL says', async () => {
    mockFetchResult = { ok: true, data: WOFF2, finalUrl: row.url };

    expect(await importRemoteImage(row)).toBe('failed');
    expect(prismaMock.asset.create).not.toHaveBeenCalled();
    expect(prismaMock.remoteImage.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: {
        attempts: 1,
        status: 'failed',
        reason: 'not an image (font/woff2)'
      }
    });
  });

  it('refuses bytes the validator does not recognise', async () => {
    mockFetchResult = {
      ok: true,
      data: Buffer.from('{"secret":"metadata"}'),
      finalUrl: row.url
    };

    expect(await importRemoteImage(row)).toBe('failed');
    expect(prismaMock.asset.create).not.toHaveBeenCalled();
    const data = prismaMock.remoteImage.update.mock.calls[0][0].data as {
      reason: string;
    };
    expect(data.reason).toMatch(/Unsupported asset type/);
  });
});

describe('processDueRemoteImages', () => {
  it('imports only the rows it managed to lease', async () => {
    const due = [
      {
        id: 1,
        url: 'https://a.example/1.png',
        attempts: 0,
        requestedById: 7,
        nextAttemptAt: new Date(0)
      },
      {
        id: 2,
        url: 'https://a.example/2.png',
        attempts: 0,
        requestedById: 7,
        nextAttemptAt: new Date(0)
      }
    ];
    prismaMock.remoteImage.findMany.mockResolvedValue(due as never);
    // Row 2 was leased by an overlapping cycle between the read and the lease.
    prismaMock.remoteImage.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    mockFetchResult = { ok: false, reason: 'gone', retryable: false };

    const tally = await processDueRemoteImages();

    expect(tally).toEqual({ imported: 0, retry: 0, failed: 1 });
    expect(prismaMock.remoteImage.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.remoteImage.update.mock.calls[0][0].where).toEqual({
      id: 1
    });
    // The lease is conditional on the row being unchanged since it was read.
    expect(prismaMock.remoteImage.updateMany.mock.calls[0][0]!.where).toEqual({
      id: 1,
      status: 'pending',
      nextAttemptAt: new Date(0)
    });
  });
});

describe('importedAssetUrls', () => {
  it('maps imported URLs to their asset path and nothing else', async () => {
    prismaMock.remoteImage.findMany.mockResolvedValue([
      { url: 'https://a.example/x.png', assetHash: 'f'.repeat(64) }
    ] as never);

    const map = await importedAssetUrls([
      'https://a.example/x.png',
      'https://a.example/pending.png'
    ]);

    expect([...map]).toEqual([
      ['https://a.example/x.png', `/api/asset/${'f'.repeat(64)}`]
    ]);
    expect(prismaMock.remoteImage.findMany.mock.calls[0][0]!.where).toEqual({
      url: { in: ['https://a.example/x.png', 'https://a.example/pending.png'] },
      status: 'imported'
    });
  });
});

const img = (n: string) => `[img]https://h.example/${n}.png[/img]`;
const url = (n: string) => `https://h.example/${n}`;

// Each table the walker reads, the rows it returns, and the URLs they hold.
// A BBCode body contributes the images it would draw; a field its URL.
const WALKED_SOURCES: {
  table: keyof PrismaClient;
  rows: Record<string, string | null>[];
  expected: string[];
}[] = [
  {
    table: 'forumPost',
    rows: [{ body: img('post') }],
    expected: [url('post.png')]
  },
  {
    table: 'comment',
    rows: [{ body: img('comment') }],
    expected: [url('comment.png')]
  },
  {
    table: 'collage',
    rows: [{ description: img('collage') }],
    expected: [url('collage.png')]
  },
  {
    table: 'wikiPage',
    rows: [{ body: img('wiki') }],
    expected: [url('wiki.png')]
  },
  {
    table: 'news',
    rows: [{ body: img('news') }],
    expected: [url('news.png')]
  },
  {
    table: 'release',
    rows: [{ description: img('release'), image: url('rimg.jpg') }],
    expected: [url('release.png'), url('rimg.jpg')]
  },
  {
    table: 'profile',
    rows: [{ profileInfo: img('profile'), avatar: url('pavatar') }],
    expected: [url('profile.png'), url('pavatar')]
  },
  {
    table: 'user',
    rows: [{ staffBio: img('staff'), avatar: url('uavatar') }],
    expected: [url('staff.png'), url('uavatar')]
  },
  {
    table: 'donorReward',
    rows: [{ customIcon: url('icon'), secondAvatar: '' }],
    expected: [url('icon')]
  },
  {
    table: 'community',
    rows: [{ image: url('community') }],
    expected: [url('community')]
  },
  {
    table: 'coverArt',
    rows: [{ image: url('cover') }],
    expected: [url('cover')]
  },
  {
    table: 'request',
    rows: [{ image: url('request') }],
    expected: [url('request')]
  },
  {
    // Already in the store: an asset path is not a remote image.
    table: 'featuredAlbum',
    rows: [{ image: `/api/asset/${'a'.repeat(64)}` }],
    expected: []
  }
];

describe('collectReferencedRemoteUrls', () => {
  it('walks every rendered BBCode body and every image field', async () => {
    for (const { table, rows } of WALKED_SOURCES) {
      const delegate = prismaMock[table] as unknown as {
        findMany: jest.Mock;
      };
      delegate.findMany.mockResolvedValue(rows as never);
    }

    const urls = await collectReferencedRemoteUrls();

    expect([...urls].sort()).toEqual(
      WALKED_SOURCES.flatMap((source) => source.expected).sort()
    );
  });
});
