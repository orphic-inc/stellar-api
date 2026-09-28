/**
 * Fetch a member-supplied URL's body on the server's behalf, safely (#737,
 * ADR-0051). The remote image import is the only caller today.
 *
 * `ssrfGuard` vets every hop, as it does for the link checker, and this module
 * closes the gap the guard documents and leaves open: DNS rebinding. The guard
 * resolves the name to check it; a plain `fetch` would resolve it again to dial,
 * and a hostile resolver can answer the second lookup with an internal address.
 * The link checker accepts that race because it sends HEAD and discards the
 * body, so winning it yields one bit. This fetch keeps the body and stores it,
 * so here the race is worth closing: the socket dials one of the addresses the
 * guard vetted, through the `lookup` hook node's http client offers, and never
 * resolves the name itself. TLS still verifies the certificate against the
 * hostname, so pinning the address costs nothing in authenticity.
 *
 * The rest bounds what a hostile or broken host can cost:
 *
 * - redirects are followed by hand, each hop re-vetted and re-pinned, within a
 *   small budget;
 * - one timeout covers the whole exchange, redirects included;
 * - the body streams against a hard byte cap and is abandoned the moment it
 *   passes it, before it is buffered in full;
 * - the request carries a fixed User-Agent and nothing else of ours: no cookie,
 *   no Referer, no credentials.
 *
 * The response's Content-Type is not consulted. What the bytes are is decided
 * by the caller, from the bytes (`assetValidate`).
 */
import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import {
  checkPublicUrl,
  type UrlGuardResult,
  type VettedAddress
} from './ssrfGuard';

export interface RemoteFetchOptions {
  maxBytes: number;
  timeoutMs: number;
  userAgent: string;
  maxRedirects?: number;
  /**
   * The egress check. Only tests replace it, to point a vetted name at a local
   * server; production always uses `checkPublicUrl`.
   */
  check?: (url: string) => Promise<UrlGuardResult>;
}

export type RemoteFetchResult =
  | { ok: true; data: Buffer; finalUrl: string }
  /**
   * `retryable` separates a failure worth another attempt later (a timeout, a
   * 5xx, a reset connection) from one that will fail the same way every time
   * (a refused address, a 404, a body over the cap).
   */
  | { ok: false; reason: string; retryable: boolean };

const DEFAULT_MAX_REDIRECTS = 5;

/**
 * A `lookup` that answers with the vetted addresses and never asks DNS. Node
 * calls it with `all: true` when it may race several addresses, and expects a
 * list back; otherwise it expects one.
 */
export const pinnedLookup = (addresses: VettedAddress[]): LookupFunction =>
  ((_hostname: string, options: { all?: boolean }, callback: unknown) => {
    const cb = callback as (
      err: NodeJS.ErrnoException | null,
      address: string | { address: string; family: number }[],
      family?: number
    ) => void;
    if (options && options.all) {
      cb(
        null,
        addresses.map((a) => ({ address: a.address, family: a.family }))
      );
      return;
    }
    cb(null, addresses[0].address, addresses[0].family);
  }) as LookupFunction;

interface HopResult {
  status: number;
  location?: string;
  data?: Buffer;
}

const oneHop = (
  url: URL,
  addresses: VettedAddress[],
  opts: RemoteFetchOptions,
  signal: AbortSignal
): Promise<HopResult> =>
  new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(
      url,
      {
        method: 'GET',
        signal,
        lookup: pinnedLookup(addresses),
        headers: {
          'User-Agent': opts.userAgent,
          Accept: 'image/*'
        }
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          resolve({ status, location: res.headers.location });
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          resolve({ status });
          return;
        }

        const declared = Number(res.headers['content-length']);
        if (Number.isFinite(declared) && declared > opts.maxBytes) {
          res.destroy();
          reject(new CapError());
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > opts.maxBytes) {
            res.destroy();
            reject(new CapError());
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ status, data: Buffer.concat(chunks) }));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.end();
  });

class CapError extends Error {
  constructor() {
    super('over the size cap');
    this.name = 'CapError';
  }
}

/** A hop's final answer: its body, or why there is none. */
const hopOutcome = (res: HopResult, url: URL): RemoteFetchResult => {
  if (res.data) return { ok: true, data: res.data, finalUrl: url.toString() };
  if (res.status >= 300 && res.status < 400) {
    return {
      ok: false,
      reason: `redirect ${res.status} with no location`,
      retryable: false
    };
  }
  return {
    ok: false,
    reason: `the host answered ${res.status}`,
    retryable: res.status >= 500 || res.status === 429
  };
};

/** What a thrown error means: over the cap, out of time, or a network fault. */
const errorOutcome = (
  err: unknown,
  opts: RemoteFetchOptions,
  timedOut: boolean
): RemoteFetchResult => {
  if (err instanceof CapError) {
    return {
      ok: false,
      reason: `larger than ${opts.maxBytes} bytes`,
      retryable: false
    };
  }
  if (timedOut) return { ok: false, reason: 'timed out', retryable: true };
  const code = (err as NodeJS.ErrnoException)?.code;
  return {
    ok: false,
    reason: code ? `connection failed (${code})` : 'connection failed',
    retryable: true
  };
};

export const fetchRemote = async (
  raw: string,
  opts: RemoteFetchOptions
): Promise<RemoteFetchResult> => {
  const check = opts.check ?? checkPublicUrl;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    let target = raw;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      // Re-vetted on every hop: an allowed host can redirect to an internal one.
      const guard = await check(target);
      if (!guard.ok) {
        return { ok: false, reason: guard.reason, retryable: false };
      }

      const res = await oneHop(
        guard.url,
        guard.addresses,
        opts,
        controller.signal
      );
      if (res.location === undefined) return hopOutcome(res, guard.url);
      target = new URL(res.location, guard.url).toString();
    }
    return { ok: false, reason: 'too many redirects', retryable: false };
  } catch (err: unknown) {
    return errorOutcome(err, opts, controller.signal.aborted);
  } finally {
    clearTimeout(timer);
  }
};
