/**
 * Egress guard for user-supplied URLs the server itself fetches.
 *
 * The link checker probes `Contribution.downloadUrl`, which is whatever a member
 * typed into the submission form. `z.string().url()` only proves the string
 * parses, and the approved-domains gate in the contribution routes is
 * conditional — `if (settings.approvedDomains.length > 0)` — so a default
 * install applies no host restriction at all. That makes the probe a
 * server-side request forgery primitive: `http://169.254.169.254/...` or
 * `http://127.0.0.1:5432/` are valid URLs, and the server is the one dialling.
 *
 * The probe is blind — callers learn PASS/WARN/FAIL, never a response body — but
 * that is not containment. The status alone distinguishes "port open" from "port
 * closed", which is a working internal port scanner, and cloud metadata
 * endpoints answer on plain HTTP with no credential at all.
 *
 * So the check lives here, at the egress point, rather than at the input
 * boundary. Validating on submission cannot be sufficient: an allowlisted host
 * is free to answer the probe with a 302 to a link-local address, and the
 * redirect is followed under the server's network identity, not the submitter's.
 * Guarding where the socket is actually opened covers both the first hop and
 * every subsequent one.
 *
 * Validate-and-reject, like `assetValidate` and `cssValidate`: this module
 * decides, and reports *why*, but never rewrites a URL into a safe one. There is
 * no safe rewriting of "this address points inside our network."
 */
import { isIP, BlockList } from 'node:net';
import { lookup } from 'node:dns/promises';

/**
 * Only these two schemes reach a network. `z.string().url()` happily accepts
 * `file:`, `ftp:` and `data:`, and undici would either read a local path or
 * throw somewhere less legible than here.
 */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Address space that must never be dialled on a user's behalf.
 *
 * These are the ranges that are either unroutable on the public internet or
 * routable only *inside* a deployment, so a public download link has no
 * legitimate reason to resolve into any of them. 169.254.0.0/16 carries the
 * cloud metadata endpoints (169.254.169.254 on AWS/GCP/Azure) and is the single
 * highest-value target here; the RFC1918 blocks and loopback are the internal
 * services; 100.64.0.0/10 is carrier-grade NAT, which in practice is where
 * Tailscale and similar overlay networks put their peers.
 */
const BLOCKED = new BlockList();
// IPv4
BLOCKED.addSubnet('0.0.0.0', 8, 'ipv4'); // "this network"
BLOCKED.addSubnet('10.0.0.0', 8, 'ipv4'); // RFC1918 private
BLOCKED.addSubnet('100.64.0.0', 10, 'ipv4'); // RFC6598 carrier-grade NAT
BLOCKED.addSubnet('127.0.0.0', 8, 'ipv4'); // loopback
BLOCKED.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local + cloud metadata
BLOCKED.addSubnet('172.16.0.0', 12, 'ipv4'); // RFC1918 private
BLOCKED.addSubnet('192.0.0.0', 24, 'ipv4'); // IETF protocol assignments
BLOCKED.addSubnet('192.168.0.0', 16, 'ipv4'); // RFC1918 private
BLOCKED.addSubnet('198.18.0.0', 15, 'ipv4'); // benchmarking
BLOCKED.addSubnet('224.0.0.0', 4, 'ipv4'); // multicast
BLOCKED.addSubnet('240.0.0.0', 4, 'ipv4'); // reserved
// IPv6
BLOCKED.addAddress('::', 'ipv6'); // unspecified
BLOCKED.addAddress('::1', 'ipv6'); // loopback
BLOCKED.addSubnet('fc00::', 7, 'ipv6'); // unique local
BLOCKED.addSubnet('fe80::', 10, 'ipv6'); // link-local
BLOCKED.addSubnet('ff00::', 8, 'ipv6'); // multicast

export type UrlGuardResult =
  { ok: true; url: URL } | { ok: false; reason: string };

/**
 * True when a literal address sits in blocked space.
 *
 * `BlockList.check` already understands IPv4-mapped IPv6 (`::ffff:127.0.0.1`
 * matches the 127.0.0.0/8 rule), so the mapped form needs no separate unwrapping
 * — but only when it is checked as `'ipv6'`, which is what `isIP` reports for it.
 */
const isBlockedAddress = (address: string): boolean => {
  const family = isIP(address);
  if (family === 4) return BLOCKED.check(address, 'ipv4');
  if (family === 6) return BLOCKED.check(address, 'ipv6');
  // Not an address at all — the caller resolved a name and handed us garbage.
  return true;
};

/**
 * Decides whether `raw` may be fetched by the server.
 *
 * Resolution is deliberately *all*-addresses and fail-closed: a name that
 * resolves to one public and one private address is rejected, because which one
 * the HTTP client ends up dialling is not ours to predict.
 *
 * This does not close the DNS-rebinding window — the name is resolved here and
 * again by the fetch, and a hostile resolver can answer differently each time.
 * Closing it properly means pinning the checked address into the connection,
 * which needs a custom undici dispatcher. That is deliberately out of scope: the
 * probe is a HEAD whose body is discarded, so the payoff for winning that race
 * is a single bit of port liveness rather than data. Every non-racing case —
 * a literal internal IP, a name that simply points inward, a redirect to
 * metadata — is closed here.
 */
export const checkPublicUrl = async (raw: string): Promise<UrlGuardResult> => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'unparseable URL' };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { ok: false, reason: `disallowed protocol '${url.protocol}'` };
  }

  // A bracketed IPv6 literal arrives as "[::1]"; URL keeps the brackets in
  // `hostname`, and neither isIP nor BlockList accepts them.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host) return { ok: false, reason: 'empty host' };

  // A literal address never reaches the resolver, so check it directly.
  if (isIP(host) !== 0) {
    return isBlockedAddress(host)
      ? { ok: false, reason: `address '${host}' is not publicly routable` }
      : { ok: true, url };
  }

  let resolved: { address: string }[];
  try {
    resolved = await lookup(host, { all: true });
  } catch {
    return { ok: false, reason: `host '${host}' did not resolve` };
  }
  if (resolved.length === 0) {
    return { ok: false, reason: `host '${host}' did not resolve` };
  }

  const blocked = resolved.find((r) => isBlockedAddress(r.address));
  if (blocked) {
    return {
      ok: false,
      reason: `host '${host}' resolves to non-routable address '${blocked.address}'`
    };
  }

  return { ok: true, url };
};
