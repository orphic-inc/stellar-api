/**
 * Store-time validation for binary assets (ADR-0026, #290).
 *
 * Validate-and-reject, matching the sibling `cssValidate`. The two once diverged
 * — CSS cleaned, binaries threw, on the reasoning that you can neutralize a
 * `url()` and still hand back valid CSS while a binary has no such middle
 * ground. ADR-0031 §5 retired the cleaning posture as a class: normalizing a
 * whole sheet in order to match it is what persisted mangled bytes (#340), so
 * CSS now rejects too and the two validators converge rather than invert.
 * The fail-closed intent was always shared — the store never persists a byte it
 * has not identified.
 *
 * Identification is by magic bytes, not by the caller's declared mime. A caller
 * claiming `image/png` over a payload that sniffs as something else is rejected
 * rather than trusted, which is the whole point: the declared type is what the
 * serve route later sends as `Content-Type`, so believing it unverified would let
 * a stored blob choose how a browser interprets it.
 */
import { AppError } from './errors';
import { assets } from '../modules/config';

/**
 * Allowlisted types and the leading bytes that identify them. Extensions live
 * here rather than at call sites so the store has exactly one notion of what it
 * accepts. Fonts are included for the asset-bearing themes; note that shipping a
 * font is a redistribution question the *caller* must have settled (postmod's
 * commercial faces are why it is not yet an api-canonical fixture).
 */
const SIGNATURES: { mime: string; magic: number[] }[] = [
  {
    mime: 'image/png',
    magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  },
  { mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', magic: [0x47, 0x49, 0x46, 0x38] },
  // RIFF....WEBP — the 4-byte length sits between the two markers, so the
  // container tag is checked at its fixed offset rather than as one run.
  { mime: 'image/webp', magic: [0x52, 0x49, 0x46, 0x46] },
  { mime: 'font/woff2', magic: [0x77, 0x4f, 0x46, 0x32] },
  { mime: 'font/otf', magic: [0x4f, 0x54, 0x54, 0x4f] },
  // TrueType: the 0x00010000 version tag. `true`/`ttcf` variants are not served.
  { mime: 'font/ttf', magic: [0x00, 0x01, 0x00, 0x00] }
];

const WEBP_TAG = [0x57, 0x45, 0x42, 0x50]; // "WEBP" at offset 8

const startsWith = (data: Buffer, magic: number[], offset = 0): boolean =>
  data.length >= offset + magic.length &&
  magic.every((byte, i) => data[offset + i] === byte);

/** The mime a payload's leading bytes actually identify, or null if unrecognized. */
export const sniffMime = (data: Buffer): string | null => {
  for (const sig of SIGNATURES) {
    if (!startsWith(data, sig.magic)) continue;
    // RIFF alone is also AVI/WAV; only the WEBP container tag makes it an image.
    if (sig.mime === 'image/webp' && !startsWith(data, WEBP_TAG, 8)) continue;
    return sig.mime;
  }
  return null;
};

/** Every mime the store will accept and serve. */
export const ALLOWED_MIMES: readonly string[] = SIGNATURES.map((s) => s.mime);

/**
 * Assert a payload is storable and return the verified mime. Throws `AppError`
 * (400) on an empty, oversize, unrecognized, or misdeclared payload.
 *
 * `declaredMime` is optional: seed fixtures infer the type from the bytes, while
 * an upload path passes what the client claimed so the mismatch can be caught.
 */
export const validateAsset = (data: Buffer, declaredMime?: string): string => {
  if (data.length === 0) {
    throw new AppError(400, 'Asset is empty.');
  }
  if (data.length > assets.maxBytes) {
    throw new AppError(
      400,
      `Asset exceeds the ${assets.maxBytes}-byte limit (got ${data.length}).`
    );
  }

  const sniffed = sniffMime(data);
  if (!sniffed) {
    throw new AppError(
      400,
      `Unsupported asset type. Allowed: ${ALLOWED_MIMES.join(', ')}.`
    );
  }
  if (declaredMime && declaredMime !== sniffed) {
    throw new AppError(
      400,
      `Asset content is ${sniffed}, not the declared ${declaredMime}.`
    );
  }

  return sniffed;
};
