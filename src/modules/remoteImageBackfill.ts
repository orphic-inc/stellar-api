/**
 * The one-time backfill of remote images stored before import existed (#738,
 * ADR-0051 §6). The CSP can close `img-src` only once every stored remote image
 * is imported or has failed for good, so this queues them all, waits for the
 * import job to finish them, and reports. Run by `scripts/backfill-remote-images.ts`.
 *
 * Idempotent. Registration leaves a known URL alone, so a re-run queues nothing
 * new and changes no owner, and a failed import stays failed rather than being
 * retried forever.
 */
import { RemoteImageStatus, type PrismaClient } from '@prisma/client';
import {
  collectImageValues,
  remoteUrlsOf,
  type ImageValue
} from './imageColumns';
import {
  processDueRemoteImages,
  registerRemoteImages,
  type ProcessOptions
} from './remoteImage';

/** URLs per `in` query and per registration, to keep each statement modest. */
const CHUNK = 500;

const chunks = <T>(items: T[]): T[][] =>
  Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, i) =>
    items.slice(i * CHUNK, (i + 1) * CHUNK)
  );

/** What a walk found: each URL's owner, and the distinct URLs per surface. */
export interface BackfillFound {
  owners: Map<string, number>;
  bySurface: Map<string, Set<string>>;
}

const time = (at: Date | null): number => at?.getTime() ?? Infinity;

/**
 * Each URL's owner is whoever wrote the earliest value holding it. A value from
 * a table with no author (news, releases, featured albums, a leaderless
 * community) is owned by `fallbackOwnerId`, the System user.
 */
export function findBackfill(
  values: ImageValue[],
  fallbackOwnerId: number
): BackfillFound {
  const earliest = new Map<string, { ownerId: number; at: number }>();
  const bySurface = new Map<string, Set<string>>();
  for (const v of values) {
    for (const url of remoteUrlsOf(v)) {
      if (!bySurface.has(v.surface)) bySurface.set(v.surface, new Set());
      bySurface.get(v.surface)!.add(url);
      const held = earliest.get(url);
      if (!held || time(v.at) < held.at)
        earliest.set(url, {
          ownerId: v.ownerId ?? fallbackOwnerId,
          at: time(v.at)
        });
    }
  }
  const owners = new Map(
    [...earliest].map(([url, held]) => [url, held.ownerId])
  );
  return { owners, bySurface };
}

/**
 * Queue every URL the walk found, owned by its earliest author and exempt from
 * the daily ceiling, which limits what a member does from now on, not what
 * they wrote before. Returns how many were new.
 */
export async function queueBackfill(
  client: PrismaClient,
  owners: Map<string, number>
): Promise<number> {
  const byOwner = new Map<number, string[]>();
  for (const [url, ownerId] of owners) {
    byOwner.set(ownerId, [...(byOwner.get(ownerId) ?? []), url]);
  }
  let queued = 0;
  for (const [ownerId, urls] of byOwner) {
    for (const part of chunks(urls)) {
      queued += await registerRemoteImages(
        part,
        ownerId,
        { exempt: true },
        client
      );
    }
  }
  return queued;
}

export interface DrainOptions {
  /** When to stop waiting, as a `Date.now()` value. */
  deadline: number;
  sleep?: (ms: number) => Promise<void>;
  process?: ProcessOptions;
}

/** Longest single wait, so a long backoff is still re-checked now and then. */
const MAX_WAIT_MS = 30_000;

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The soonest a still-pending URL among `urls` is due, or null if none is. */
async function nextPendingAt(
  client: PrismaClient,
  urls: string[]
): Promise<number | null> {
  let soonest: number | null = null;
  for (const part of chunks(urls)) {
    const row = await client.remoteImage.findFirst({
      where: { url: { in: part }, status: RemoteImageStatus.pending },
      orderBy: { nextAttemptAt: 'asc' },
      select: { nextAttemptAt: true }
    });
    const at = row?.nextAttemptAt.getTime();
    if (at !== undefined && (soonest === null || at < soonest)) soonest = at;
  }
  return soonest;
}

/**
 * Import the queue until none of `urls` is pending, or the deadline passes.
 * Runs the import itself rather than waiting on the api's job; leases keep the
 * two from importing the same row twice. Retries back off for over an hour in
 * all, so a deadline that short can end with URLs still pending.
 */
export async function drainBackfill(
  client: PrismaClient,
  urls: string[],
  opts: DrainOptions
): Promise<void> {
  const sleep = opts.sleep ?? defaultSleep;
  for (;;) {
    await processDueRemoteImages(client, opts.process);
    const next = await nextPendingAt(client, urls);
    const now = Date.now();
    if (next === null || now >= opts.deadline) return;
    const wait = Math.min(Math.max(0, next - now), opts.deadline - now);
    if (wait > 0) await sleep(Math.min(wait, MAX_WAIT_MS));
  }
}

export interface BackfillFailure {
  url: string;
  host: string;
  reason: string;
}

export interface BackfillReport {
  bySurface: Record<string, number>;
  total: number;
  queued: number;
  imported: number;
  pending: number;
  failed: BackfillFailure[];
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** Where every URL the walk found stands now. */
export async function reportBackfill(
  client: PrismaClient,
  found: BackfillFound,
  queued: number
): Promise<BackfillReport> {
  const urls = [...found.owners.keys()];
  const rows = (
    await Promise.all(
      chunks(urls).map((part) =>
        client.remoteImage.findMany({
          where: { url: { in: part } },
          select: { url: true, status: true, reason: true }
        })
      )
    )
  ).flat();
  const count = (status: RemoteImageStatus) =>
    rows.filter((r) => r.status === status).length;
  const failed = rows
    .filter((r) => r.status === RemoteImageStatus.failed)
    .map((r) => ({ url: r.url, host: hostOf(r.url), reason: r.reason ?? '' }));
  return {
    bySurface: Object.fromEntries(
      [...found.bySurface].map(([surface, set]) => [surface, set.size])
    ),
    total: urls.length,
    queued,
    imported: count(RemoteImageStatus.imported),
    // A URL with no row was not registered, which counts as not done yet.
    pending: urls.length - count(RemoteImageStatus.imported) - failed.length,
    failed
  };
}

/** The report as text: counts, then each failure grouped by host. */
export function formatBackfillReport(report: BackfillReport): string {
  const lines = [
    'Remote image backfill (#738)',
    '',
    'Distinct remote image URLs found, per surface:',
    ...Object.entries(report.bySurface)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([surface, n]) => `  ${surface}: ${n}`),
    '',
    `Total distinct URLs: ${report.total} (${report.queued} newly queued)`,
    `Imported: ${report.imported}`,
    `Failed:   ${report.failed.length}`,
    `Pending:  ${report.pending}`
  ];
  const byHost = new Map<string, BackfillFailure[]>();
  for (const f of report.failed) {
    byHost.set(f.host, [...(byHost.get(f.host) ?? []), f]);
  }
  for (const [host, failures] of [...byHost].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    lines.push('', `Failed on ${host} (${failures.length}):`);
    for (const f of failures) lines.push(`  ${f.url}`, `    ${f.reason}`);
  }
  return lines.join('\n');
}

/** Walk, queue, drain and report: the whole backfill. */
export async function runBackfill(
  client: PrismaClient,
  fallbackOwnerId: number,
  drain: DrainOptions | null
): Promise<BackfillReport> {
  const found = findBackfill(await collectImageValues(client), fallbackOwnerId);
  const queued = await queueBackfill(client, found.owners);
  if (drain) await drainBackfill(client, [...found.owners.keys()], drain);
  return reportBackfill(client, found, queued);
}
