import { prisma } from '../lib/prisma';
import { TtlCache } from '../lib/ttlCache';
import { normalizeIp, ipInRange } from '../lib/ipAddress';

/**
 * IP ban enforcement (#540).
 *
 * `IpBan` shipped with CRUD routes, an `ip_bans_manage` permission and OpenAPI
 * registration, and nothing ever read the table. A moderator could ban a
 * network, receive a 201, see it listed, and it did nothing — the same defect as
 * the email blacklist, and the more misleading of the two, because every signal
 * said the ban was in force.
 *
 * Enforcement could not land before #542: `trust proxy` was unset while the
 * client IP was read from a hand-parsed `X-Forwarded-For`, so a ban would have
 * been bypassable with one header. Building it then would have replaced a
 * control that did nothing with one that appeared to work.
 */

const CACHE_KEY = 'ip-bans';
const TTL_MS = 60_000;

const cache = new TtlCache();

type BanRange = { fromIp: string; toIp: string };

/**
 * The ban list, cached for a minute.
 *
 * Cached because this is consulted on every request and the list is tiny — a
 * staff-curated set of ranges, not user data. A minute bounds how long a freshly
 * added ban takes to bite, which is the trade a moderator would accept over a
 * database round-trip per request; `invalidateIpBanCache` makes it immediate on
 * the write path anyway.
 *
 * The whole list is loaded rather than queried per-address because containment
 * is then a comparison over a handful of fixed-width strings, and because a
 * per-request query would defeat the cache entirely.
 */
const loadBans = async (): Promise<BanRange[]> => {
  const cached = cache.get<BanRange[]>(CACHE_KEY);
  if (cached) return cached;

  const bans = await prisma.ipBan.findMany({
    select: { fromIp: true, toIp: true }
  });
  cache.set(CACHE_KEY, bans, TTL_MS);
  return bans;
};

/** Drop the cached list — called by the ban write routes. */
export const invalidateIpBanCache = (): void => cache.delete(CACHE_KEY);

/**
 * Is this address inside any ban range?
 *
 * An address that will not normalise returns `false`. Failing open is
 * deliberate: the alternative is refusing traffic we cannot parse, and a parser
 * gap would then become a site outage. A ban that misses is recoverable; a site
 * that refuses everyone is not.
 */
export const isIpBanned = async (ip: string | undefined): Promise<boolean> => {
  if (!ip) return false;
  const candidate = normalizeIp(ip);
  if (!candidate) return false;

  const bans = await loadBans();
  return bans.some((ban) => ipInRange(candidate, ban.fromIp, ban.toIp));
};
