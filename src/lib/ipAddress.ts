/**
 * IP address normalisation for the ban list (#540).
 *
 * `IpBan` stored two signed 32-bit `Int` columns, which is wrong in three ways
 * for the job it was doing:
 *
 *   1. `parseIpv4ToInt` ended in `| 0`, so every address from `128.0.0.0` up was
 *      stored negative. A range CROSSING that boundary — `100.0.0.0` to
 *      `200.0.0.0` — stored `from = 1677721600` and `to = -939524096`, and a SQL
 *      `from <= c AND to >= c` can never be satisfied. The route's validator
 *      accepted such ranges (it compared with `>>> 0`), so staff could create a
 *      ban that silently matched nothing.
 *   2. IPv6 was unrepresentable, while nginx listens on `[::]:80` — so IPv6
 *      clients connected and could not be banned at all.
 *   3. `req.ip` may be IPv4-mapped (`::ffff:8.8.8.8`) on a dual-stack socket,
 *      which the IPv4-only parser rejected outright.
 *
 * Every address is normalised to **32 lowercase hex characters** — the full
 * 128-bit value, with IPv4 mapped into `::ffff:0:0/96` as the standard does.
 * Fixed width is what makes this work: lexicographic ordering then equals
 * numeric ordering, so `from <= c AND to <= c` is correct in SQL for both
 * families at once, and an ordinary btree index serves it.
 */

/** 32 lowercase hex chars, or null when the input is not an address. */
export const normalizeIp = (input: string): string | null => {
  const value = input.trim().toLowerCase();
  if (value === '') return null;

  // IPv4-mapped IPv6 (`::ffff:1.2.3.4`) is an IPv4 address wearing a hat.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  const candidate = mapped ? mapped[1] : value;

  if (candidate.includes('.')) return normalizeIpv4(candidate);
  if (candidate.includes(':')) return normalizeIpv6(candidate);
  return null;
};

const normalizeIpv4 = (value: string): string | null => {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  // Reject leading zeros: `010.0.0.1` is ambiguous (octal in some parsers) and
  // would otherwise normalise to the same row as `10.0.0.1`, letting one ban be
  // written two ways.
  if (!parts.every((p) => /^(0|[1-9]\d{0,2})$/.test(p))) return null;
  const octets = parts.map(Number);
  if (octets.some((o) => o > 255)) return null;
  const v4 = octets.map((o) => o.toString(16).padStart(2, '0')).join('');
  // ::ffff:0:0/96 — the IPv4-mapped range.
  return '00000000000000000000ffff' + v4;
};

/**
 * Rewrite a trailing dotted quad into two hex groups.
 *
 * `::ffff:1.2.3.4` and `64:ff9b::1.2.3.4` write their last 32 bits in IPv4
 * form. Returns the text unchanged when there is no such tail, or null when the
 * tail is present but not a valid IPv4 address.
 */
const rewriteIpv4Tail = (value: string): string | null => {
  const tail = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (!tail) return value;
  const v4 = normalizeIpv4(tail[2]);
  if (!v4) return null;
  const last32 = v4.slice(-8);
  return `${tail[1]}${last32.slice(0, 4)}:${last32.slice(4)}`;
};

/** Split into hex groups, or null if any group is malformed. */
const hexGroups = (part: string): string[] | null => {
  if (part === '') return [];
  const groups = part.split(':');
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups;
};

/** Expand the `::` elision to exactly eight groups. */
const expandElision = (head: string, tail: string): string[] | null => {
  const a = hexGroups(head);
  const b = hexGroups(tail);
  if (a === null || b === null) return null;
  const missing = 8 - a.length - b.length;
  // `::` must stand for at least one group, or the address is over-long.
  if (missing < 1) return null;
  return [...a, ...Array(missing).fill('0'), ...b];
};

const normalizeIpv6 = (value: string): string | null => {
  const text = rewriteIpv4Tail(value);
  if (text === null) return null;

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const groups =
    halves.length === 2
      ? expandElision(halves[0], halves[1])
      : hexGroups(text)?.length === 8
        ? hexGroups(text)
        : null;

  if (groups === null || groups === undefined) return null;
  return groups.map((g) => g.padStart(4, '0')).join('');
};

/** Is `candidate` inside the inclusive range? All three must be normalised. */
export const ipInRange = (
  candidate: string,
  fromIp: string,
  toIp: string
): boolean => candidate >= fromIp && candidate <= toIp;

/** Presentation form, for reading a ban back out. */
export const denormalizeIp = (hex: string): string => {
  if (hex.startsWith('00000000000000000000ffff')) {
    const v4 = hex.slice(-8);
    return [0, 2, 4, 6].map((i) => parseInt(v4.slice(i, i + 2), 16)).join('.');
  }
  const groups: string[] = [];
  for (let i = 0; i < 32; i += 4) {
    groups.push(hex.slice(i, i + 4).replace(/^0+(?=.)/, ''));
  }
  return groups.join(':');
};
