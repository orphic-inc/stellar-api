/**
 * The resolved `*Src` sibling of every image field a response carries (#737
 * slice 3, ADR-0051).
 *
 * An image field keeps the value the member wrote, because edit forms prefill
 * from it. Beside it goes the address a browser may actually load:
 *
 * - an `/api/asset/<hash>` path, or any other path on this origin such as a
 *   community's default image, as is;
 * - a remote URL that has been imported, as its asset path;
 * - anything else as `null`: pending, failed, unknown, or not a URL at all. The
 *   UI then shows the surface's default.
 *
 * So a `*Src` is never a remote URL, and that is what lets the CSP close
 * `img-src` to `'self'` (#457).
 *
 * One response hook applies this to every JSON body (`middleware/imageSrc.ts`),
 * so a new surface gets its siblings without remembering to ask for them. The
 * OpenAPI document declares them by the same rule (`lib/openapiImageSrc.ts`).
 */
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { importedAssetUrls, isImportableUrl } from './remoteImage';
import { getLogger } from './logging';

const log = getLogger('imageSrc');

/** The keys that hold an image, wherever they appear in a response. */
export const IMAGE_FIELDS = [
  'avatar',
  'image',
  'customIcon',
  'secondAvatar'
] as const;

/**
 * The keys that hold a list of images, such as a collage's `coverImages`. The
 * sibling is the list a browser may load: each resolved, the unimported
 * dropped.
 */
export const IMAGE_LIST_FIELDS = ['coverImages'] as const;

export const srcKey = (field: string): string => `${field}Src`;

type Plain = Record<string, unknown>;

const isPlainObject = (value: unknown): value is Plain => {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** Every plain object in `payload` that holds an image field. */
function holders(payload: unknown): Plain[] {
  const out: Plain[] = [];
  const seen = new WeakSet<object>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!isPlainObject(node) || seen.has(node)) return;
    seen.add(node);
    if (holdsImage(node)) out.push(node);
    Object.values(node).forEach(visit);
  };
  visit(payload);
  return out;
}

/** A field present as a string or null; any other type is not an image. */
const isImageValue = (node: Plain, field: string): boolean =>
  field in node && (node[field] === null || typeof node[field] === 'string');

/** A list field present as an array of strings. */
const isImageList = (node: Plain, field: string): boolean =>
  Array.isArray(node[field]) &&
  (node[field] as unknown[]).every((v) => typeof v === 'string');

const holdsImage = (node: Plain): boolean =>
  IMAGE_FIELDS.some((field) => isImageValue(node, field)) ||
  IMAGE_LIST_FIELDS.some((field) => isImageList(node, field));

/** Every raw image value one holder carries, lists included. */
const rawValues = (node: Plain): string[] =>
  [
    ...IMAGE_FIELDS.filter((field) => isImageValue(node, field)).map((field) =>
      String(node[field] ?? '')
    ),
    ...IMAGE_LIST_FIELDS.filter((field) => isImageList(node, field)).flatMap(
      (field) => node[field] as string[]
    )
  ].map((value) => value.trim());

/** The imported asset paths of the remote URLs among `values`. */
async function importedPaths(
  values: string[],
  client: PrismaClient
): Promise<Map<string, string>> {
  const remote = values.filter(isImportableUrl);
  if (remote.length === 0) return new Map();
  try {
    return await importedAssetUrls(remote, client);
  } catch (err) {
    // Fail closed: without the lookup, a remote image resolves to null, which
    // shows the default rather than fetching the remote host.
    log.error('Image src lookup failed', { err });
    return new Map();
  }
}

/**
 * A path on this origin: `/x`, but not the protocol-relative `//host/x`. No
 * whitespace or backslash anywhere, since a browser strips a tab or newline
 * from a URL, and `/\t/host` would then load `//host`.
 */
const SAME_ORIGIN_PATH = /^\/(?![/\\])[^\s\\]*$/;

/** What a browser may load for one raw image value. */
const resolveOne = (
  raw: unknown,
  imported: Map<string, string>
): string | null => {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (SAME_ORIGIN_PATH.test(value)) return value;
  return imported.get(value) ?? null;
};

/**
 * Add the `*Src` sibling to every image field in `payload`, in place, with one
 * lookup for the whole body. Never throws for a lookup failure.
 */
export async function addImageSrcs(
  payload: unknown,
  client: PrismaClient = prisma
): Promise<void> {
  const found = holders(payload);
  if (found.length === 0) return;

  const values = found.flatMap(rawValues);
  const imported = await importedPaths([...new Set(values)], client);
  for (const node of found) assignSrcs(node, imported);
}

/** Write one holder's siblings from the resolved lookup. */
function assignSrcs(node: Plain, imported: Map<string, string>): void {
  for (const field of IMAGE_FIELDS) {
    if (isImageValue(node, field))
      node[srcKey(field)] = resolveOne(node[field], imported);
  }
  for (const field of IMAGE_LIST_FIELDS) {
    if (!isImageList(node, field)) continue;
    node[srcKey(field)] = (node[field] as string[])
      .map((value) => resolveOne(value, imported))
      .filter((src): src is string => src !== null);
  }
}
