/**
 * Remote image import (#737, ADR-0051).
 *
 * A remote image a member references is fetched ONCE, by the server, validated
 * and stored as an `Imported` asset. Rendering then points at the asset, so no
 * viewer's browser ever fetches the remote host, which is what lets the CSP's
 * `img-src` close to `'self'` (#457). The member's text keeps the URL they wrote.
 *
 * Four pieces, in the order a URL meets them:
 *
 * 1. `registerRemoteImages`: a write records each URL as a `pending` row, once
 *    site-wide, charged against the writer's daily ceiling.
 * 2. `processDueRemoteImages`: the job leases due rows and imports them with
 *    bounded concurrency; a retryable failure backs off, a final one records why.
 * 3. `importedAssetUrls`: rendering asks which URLs are imported, and where.
 * 4. `collectReferencedRemoteUrls`: every remote image URL any stored content
 *    still references, which the asset sweep keeps and the backfill (#738) walks.
 */
import {
  AssetKind,
  RemoteImageStatus,
  type PrismaClient,
  type RemoteImage
} from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { fetchRemote, type RemoteFetchOptions } from '../lib/remoteFetch';
import { validateAsset } from '../lib/assetValidate';
import { remoteImageUrls } from '../lib/bbcode/images';
import { appVersion } from '../lib/version';
import { assetUrl, putAsset } from './assetStore';
import { assets, email, imageImport } from './config';
import { getLogger } from './logging';

const log = getLogger('remoteImage');

/** The longest URL a row holds; matches the column. */
export const REMOTE_URL_MAX = 2000;

/** One fetch, redirects included. A safety bound, so a constant, not config. */
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Waits before each retry of a retryable failure. After the last, the row fails
 * for good: a host still down after an hour and a quarter is a dead link.
 */
const RETRY_DELAYS_MS = [60_000, 10 * 60_000, 60 * 60_000];

/**
 * How long a leased row is hidden from other cycles. Longer than a fetch can
 * take, so an overlapping cycle never imports the same row twice; if the
 * process dies mid-import, the row becomes due again when the lease lapses.
 */
const LEASE_MS = 5 * 60_000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A URL the importer may be asked to fetch: http(s), parseable, not too long. */
export const isImportableUrl = (url: string): boolean => {
  if (url.length > REMOTE_URL_MAX || !/^https?:\/\//i.test(url)) return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

export interface RegisterOptions {
  /**
   * Skip the daily ceiling. Only the backfill (#738) sets it: the ceiling limits
   * what a member does from now on, not what they wrote before import existed.
   */
  exempt?: boolean;
}

/**
 * Record the remote image URLs a write introduces, as `pending` rows the job
 * will import. A URL already known, in any status, is left alone and costs
 * nothing. New URLs count against the writer's ceiling, and a write that would
 * pass it is refused whole, before anything is recorded.
 *
 * Returns how many URLs were newly queued. Call it from the write path of every
 * surface that renders remote images (#737 slices 2 and 3).
 */
export async function registerRemoteImages(
  urls: string[],
  requesterId: number,
  opts: RegisterOptions = {},
  client: PrismaClient = prisma
): Promise<number> {
  const wanted = [...new Set(urls.map((u) => u.trim()))].filter(
    isImportableUrl
  );
  if (wanted.length === 0) return 0;

  const known = await client.remoteImage.findMany({
    where: { url: { in: wanted } },
    select: { url: true }
  });
  const knownUrls = new Set(known.map((r) => r.url));
  const fresh = wanted.filter((u) => !knownUrls.has(u));
  if (fresh.length === 0) return 0;

  if (!opts.exempt) {
    const limit = imageImport.dailyLimit;
    const used = await client.remoteImage.count({
      where: {
        requestedById: requesterId,
        createdAt: { gt: new Date(Date.now() - DAY_MS) }
      }
    });
    if (used + fresh.length > limit) {
      const left = Math.max(0, limit - used);
      throw new AppError(
        429,
        `This adds ${fresh.length} new remote images, and you can add ${left} more today ` +
          `(${limit} per 24 hours). Upload them instead, or reuse images already on the site.`
      );
    }
  }

  // skipDuplicates: two writes racing on the same new URL both land as one row.
  const { count } = await client.remoteImage.createMany({
    data: fresh.map((url) => ({ url, requestedById: requesterId })),
    skipDuplicates: true
  });
  return count;
}

/** `registerRemoteImages` for a BBCode body: the URLs it would draw as images. */
export const registerBBCodeImages = (
  body: string | null | undefined,
  requesterId: number,
  opts: RegisterOptions = {},
  client: PrismaClient = prisma
): Promise<number> =>
  registerRemoteImages(remoteImageUrls(body), requesterId, opts, client);

export type ImportOutcome = 'imported' | 'retry' | 'failed';

/**
 * Fetch one row's URL, validate the bytes, store them, and record the result.
 * Never throws for a bad URL or host: every such outcome is written to the row.
 */
export async function importRemoteImage(
  row: Pick<RemoteImage, 'id' | 'url' | 'attempts' | 'requestedById'>,
  client: PrismaClient = prisma,
  fetchOptions: Partial<RemoteFetchOptions> = {}
): Promise<ImportOutcome> {
  const attempts = row.attempts + 1;
  const result = await fetchRemote(row.url, {
    maxBytes: assets.maxBytes,
    timeoutMs: FETCH_TIMEOUT_MS,
    userAgent: `StellarImageImport/${appVersion} (+${email.siteUrl})`,
    ...fetchOptions
  });

  if (!result.ok) {
    return recordFetchFailure(client, row.id, attempts, result);
  }

  const mime = imageMime(result.data);
  if (!mime.ok) {
    await fail(client, row.id, attempts, mime.reason);
    return 'failed';
  }

  const asset = await putAsset(
    {
      data: result.data,
      kind: AssetKind.Imported,
      mime: mime.mime,
      ownerId: row.requestedById
    },
    client
  );
  await client.remoteImage.update({
    where: { id: row.id },
    data: {
      attempts,
      status: RemoteImageStatus.imported,
      reason: null,
      assetHash: asset.hash
    }
  });
  return 'imported';
}

/**
 * A failed fetch: back off and retry if it may succeed later and retries remain,
 * otherwise record the failure for good.
 */
const recordFetchFailure = async (
  client: PrismaClient,
  id: number,
  attempts: number,
  result: { reason: string; retryable: boolean }
): Promise<ImportOutcome> => {
  const delay = RETRY_DELAYS_MS[attempts - 1];
  if (!result.retryable || delay === undefined) {
    await fail(client, id, attempts, result.reason);
    return 'failed';
  }
  await client.remoteImage.update({
    where: { id },
    data: {
      attempts,
      reason: result.reason,
      nextAttemptAt: new Date(Date.now() + delay)
    }
  });
  return 'retry';
};

type MimeResult = { ok: true; mime: string } | { ok: false; reason: string };

/** What the bytes are, from the bytes; anything but an image is refused. */
function imageMime(data: Buffer): MimeResult {
  let mime: string;
  try {
    mime = validateAsset(data);
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
  if (!mime.startsWith('image/')) {
    return { ok: false, reason: `not an image (${mime})` };
  }
  return { ok: true, mime };
}

const fail = (
  client: PrismaClient,
  id: number,
  attempts: number,
  reason: string
) =>
  client.remoteImage.update({
    where: { id },
    data: {
      attempts,
      status: RemoteImageStatus.failed,
      reason: reason.slice(0, 300)
    }
  });

export interface ProcessOptions {
  batch?: number;
  concurrency?: number;
  fetchOptions?: Partial<RemoteFetchOptions>;
}

/**
 * One job cycle: lease the due `pending` rows and import them, a few at a time.
 * A row is leased by pushing its `nextAttemptAt` out with a conditional update,
 * so two overlapping cycles never import the same row.
 */
export async function processDueRemoteImages(
  client: PrismaClient = prisma,
  opts: ProcessOptions = {}
): Promise<Record<ImportOutcome, number>> {
  const batch = opts.batch ?? 20;
  const concurrency = opts.concurrency ?? 4;
  const tally: Record<ImportOutcome, number> = {
    imported: 0,
    retry: 0,
    failed: 0
  };

  const now = new Date();
  const due = await client.remoteImage.findMany({
    where: {
      status: RemoteImageStatus.pending,
      nextAttemptAt: { lte: now }
    },
    orderBy: { nextAttemptAt: 'asc' },
    take: batch,
    select: {
      id: true,
      url: true,
      attempts: true,
      requestedById: true,
      nextAttemptAt: true
    }
  });

  const leased: typeof due = [];
  for (const row of due) {
    const { count } = await client.remoteImage.updateMany({
      where: {
        id: row.id,
        status: RemoteImageStatus.pending,
        nextAttemptAt: row.nextAttemptAt
      },
      data: { nextAttemptAt: new Date(now.getTime() + LEASE_MS) }
    });
    if (count === 1) leased.push(row);
  }

  const queue = [...leased];
  const worker = async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      try {
        tally[await importRemoteImage(row, client, opts.fetchOptions)]++;
      } catch (err) {
        // A database error, not a bad host. The lease lapses and it is retried.
        log.error('Remote image import errored', { id: row.id, err });
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, worker)
  );

  if (leased.length > 0) log.info('Remote image import cycle', tally);
  return tally;
}

/**
 * The asset path each of `urls` renders as, for those that are imported. A URL
 * that is pending, failed or unknown is absent, and the caller renders it as a
 * link or a default instead, never as a remote image.
 */
export async function importedAssetUrls(
  urls: string[],
  client: PrismaClient = prisma
): Promise<Map<string, string>> {
  if (urls.length === 0) return new Map();
  const rows = await client.remoteImage.findMany({
    where: {
      url: { in: [...new Set(urls)] },
      status: RemoteImageStatus.imported
    },
    select: { url: true, assetHash: true }
  });
  const out = new Map<string, string>();
  for (const r of rows) if (r.assetHash) out.set(r.url, assetUrl(r.assetHash));
  return out;
}

const remoteField = (value: string | null | undefined): string[] =>
  value && isImportableUrl(value.trim()) ? [value.trim()] : [];

type Text = string | null | undefined;

/**
 * One table's contribution to the walk: the BBCode bodies it holds and the
 * fields that hold an image URL. Adding a surface that renders a remote image
 * means adding its source here (ADR-0051 §5).
 */
type Source = (
  client: PrismaClient
) => Promise<{ bodies?: Text[]; fields?: Text[] }>;

// Only rows whose text mentions an [img] tag can hold one.
const HAS_IMG = { contains: '[img', mode: 'insensitive' as const };

const SOURCES: Source[] = [
  async (c) => ({
    bodies: (
      await c.forumPost.findMany({
        where: { body: HAS_IMG },
        select: { body: true }
      })
    ).map((r) => r.body)
  }),
  async (c) => ({
    bodies: (
      await c.comment.findMany({
        where: { body: HAS_IMG },
        select: { body: true }
      })
    ).map((r) => r.body)
  }),
  async (c) => ({
    bodies: (
      await c.collage.findMany({
        where: { description: HAS_IMG },
        select: { description: true }
      })
    ).map((r) => r.description)
  }),
  async (c) => ({
    bodies: (
      await c.wikiPage.findMany({
        where: { body: HAS_IMG },
        select: { body: true }
      })
    ).map((r) => r.body)
  }),
  async (c) => ({
    bodies: (
      await c.news.findMany({
        where: { body: HAS_IMG },
        select: { body: true }
      })
    ).map((r) => r.body)
  }),
  async (c) => {
    const rows = await c.release.findMany({
      select: { description: true, image: true }
    });
    return {
      bodies: rows.map((r) => r.description),
      fields: rows.map((r) => r.image)
    };
  },
  async (c) => {
    const rows = await c.profile.findMany({
      select: { profileInfo: true, avatar: true }
    });
    return {
      bodies: rows.map((r) => r.profileInfo),
      fields: rows.map((r) => r.avatar)
    };
  },
  async (c) => {
    const rows = await c.user.findMany({
      where: { OR: [{ avatar: { not: null } }, { staffBio: HAS_IMG }] },
      select: { avatar: true, staffBio: true }
    });
    return {
      bodies: rows.map((r) => r.staffBio),
      fields: rows.map((r) => r.avatar)
    };
  },
  async (c) => ({
    fields: (
      await c.donorReward.findMany({
        select: { customIcon: true, secondAvatar: true }
      })
    ).flatMap((r) => [r.customIcon, r.secondAvatar])
  }),
  async (c) => ({
    fields: (await c.community.findMany({ select: { image: true } })).map(
      (r) => r.image
    )
  }),
  async (c) => ({
    fields: (await c.coverArt.findMany({ select: { image: true } })).map(
      (r) => r.image
    )
  }),
  async (c) => ({
    fields: (
      await c.request.findMany({
        where: { image: { not: null } },
        select: { image: true }
      })
    ).map((r) => r.image)
  }),
  async (c) => ({
    fields: (await c.featuredAlbum.findMany({ select: { image: true } })).map(
      (r) => r.image
    )
  })
];

/**
 * Every remote image URL that stored content still references: the BBCode
 * bodies the api renders, and the fields that hold an image URL.
 *
 * Soft-deleted rows count. A trashed post can be restored, and its images
 * should come back with it.
 *
 * Reads every row of those tables, like the rest of the sweep. That is fine at
 * today's size; the sources are the place to add paging if it stops being.
 */
export async function collectReferencedRemoteUrls(
  client: PrismaClient = prisma
): Promise<Set<string>> {
  const found = await Promise.all(SOURCES.map((source) => source(client)));
  const out = new Set<string>();
  for (const { bodies = [], fields = [] } of found) {
    for (const body of bodies) {
      for (const url of remoteImageUrls(body)) out.add(url);
    }
    for (const field of fields) {
      for (const url of remoteField(field)) out.add(url);
    }
  }
  return out;
}
