/**
 * Every stored column that can hold an image, in one list (#737, #740, #738;
 * ADR-0051 §5). Three readers share it, so a new image column is added once:
 *
 * - the asset sweep, for the `/api/asset/` hashes still referenced and the
 *   remote URLs whose imports it must keep;
 * - `pruneUnreferencedRemoteImages`, for URLs nothing references any more;
 * - the backfill (#738), which also needs who wrote each value, and when, to
 *   give each URL its earliest author as owner.
 *
 * Soft-deleted rows count. A trashed post can be restored, and its images
 * should come back with it.
 *
 * Reads every row of those tables. That is fine at today's size; the sources
 * are the place to add paging if it stops being.
 */
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { remoteImageUrls } from '../lib/bbcode/images';
import { remoteField } from './remoteImage';

type Text = string | null | undefined;

/** One stored value that can hold an image, and who wrote it when. */
export interface ImageValue {
  /** The column, as `table.column`, for the backfill's report. */
  surface: string;
  /** A BBCode body the api renders, or a field holding one image. */
  kind: 'body' | 'field';
  text: Text;
  /** Null for a table with no author, such as news. */
  ownerId: number | null;
  /** Null for a table with no timestamp. */
  at: Date | null;
}

type Source = (client: PrismaClient) => Promise<ImageValue[]>;

// Only rows whose text mentions an [img] tag can hold one.
const HAS_IMG = { contains: '[img', mode: 'insensitive' as const };

const value = (
  surface: string,
  kind: ImageValue['kind'],
  text: Text,
  ownerId: number | null,
  at: Date | null
): ImageValue => ({ surface, kind, text, ownerId, at });

/** Tables holding only BBCode bodies. */
const PROSE_SOURCES: Source[] = [
  async (c) =>
    (
      await c.forumPost.findMany({
        where: { body: HAS_IMG },
        select: { body: true, authorId: true, createdAt: true }
      })
    ).map((r) =>
      value('forumPost.body', 'body', r.body, r.authorId, r.createdAt)
    ),
  async (c) =>
    (
      await c.comment.findMany({
        where: { body: HAS_IMG },
        select: { body: true, authorId: true, createdAt: true }
      })
    ).map((r) =>
      value('comment.body', 'body', r.body, r.authorId, r.createdAt)
    ),
  async (c) =>
    (
      await c.collage.findMany({
        where: { description: HAS_IMG },
        select: { description: true, userId: true, createdAt: true }
      })
    ).map((r) =>
      value('collage.description', 'body', r.description, r.userId, r.createdAt)
    ),
  async (c) =>
    (
      await c.wikiPage.findMany({
        where: { body: HAS_IMG },
        select: { body: true, authorId: true, createdAt: true }
      })
    ).map((r) =>
      value('wikiPage.body', 'body', r.body, r.authorId, r.createdAt)
    ),
  async (c) =>
    (
      await c.news.findMany({
        where: { body: HAS_IMG },
        select: { body: true, createdAt: true }
      })
    ).map((r) => value('news.body', 'body', r.body, null, r.createdAt))
];

/** Tables holding both a BBCode body and an image field. */
const MIXED_SOURCES: Source[] = [
  async (c) =>
    (
      await c.release.findMany({
        select: { description: true, image: true, createdAt: true }
      })
    ).flatMap((r) => [
      value('release.description', 'body', r.description, null, r.createdAt),
      value('release.image', 'field', r.image, null, r.createdAt)
    ]),
  async (c) =>
    (
      await c.profile.findMany({
        select: {
          profileInfo: true,
          avatar: true,
          user: { select: { id: true, createdAt: true } }
        }
      })
    ).flatMap((r) => {
      const [id, at] = [r.user?.id ?? null, r.user?.createdAt ?? null];
      return [
        value('profile.profileInfo', 'body', r.profileInfo, id, at),
        value('profile.avatar', 'field', r.avatar, id, at)
      ];
    }),
  async (c) =>
    (
      await c.user.findMany({
        where: { OR: [{ avatar: { not: null } }, { staffBio: HAS_IMG }] },
        select: { id: true, avatar: true, staffBio: true, createdAt: true }
      })
    ).flatMap((r) => [
      value('user.staffBio', 'body', r.staffBio, r.id, r.createdAt),
      value('user.avatar', 'field', r.avatar, r.id, r.createdAt)
    ])
];

/** Tables holding only image fields. */
const FIELD_SOURCES: Source[] = [
  async (c) =>
    (
      await c.donorReward.findMany({
        select: { customIcon: true, secondAvatar: true, userId: true }
      })
    ).flatMap((r) => [
      value('donorReward.customIcon', 'field', r.customIcon, r.userId, null),
      value('donorReward.secondAvatar', 'field', r.secondAvatar, r.userId, null)
    ]),
  async (c) =>
    (
      await c.community.findMany({
        select: { image: true, leaderId: true, createdAt: true }
      })
    ).map((r) =>
      value('community.image', 'field', r.image, r.leaderId, r.createdAt)
    ),
  async (c) =>
    (
      await c.coverArt.findMany({
        select: { image: true, userId: true, addedAt: true }
      })
    ).map((r) =>
      value('coverArt.image', 'field', r.image, r.userId, r.addedAt)
    ),
  async (c) =>
    (
      await c.request.findMany({
        where: { image: { not: null } },
        select: { image: true, userId: true, createdAt: true }
      })
    ).map((r) =>
      value('request.image', 'field', r.image, r.userId, r.createdAt)
    ),
  async (c) =>
    (
      await c.featuredAlbum.findMany({
        select: { image: true, started: true }
      })
    ).map((r) =>
      value('featuredAlbum.image', 'field', r.image, null, r.started)
    )
];

/** Every stored value that can hold an image, with its author and time. */
export async function collectImageValues(
  client: PrismaClient = prisma
): Promise<ImageValue[]> {
  const sources = [...PROSE_SOURCES, ...MIXED_SOURCES, ...FIELD_SOURCES];
  const found = await Promise.all(sources.map((source) => source(client)));
  return found.flat();
}

/** The remote image URLs one value holds. */
export const remoteUrlsOf = (v: ImageValue): string[] =>
  v.kind === 'body' ? remoteImageUrls(v.text) : remoteField(v.text);

/** Every stored value that can hold an image, split by kind. */
export interface ImageColumns {
  /** The BBCode bodies the api renders. */
  bodies: Text[];
  /** The fields that hold one image each: a remote URL or an asset path. */
  fields: Text[];
}

/** Read every image-bearing column, once. */
export async function collectImageColumns(
  client: PrismaClient = prisma
): Promise<ImageColumns> {
  const values = await collectImageValues(client);
  const texts = (kind: ImageValue['kind']) =>
    values.filter((v) => v.kind === kind).map((v) => v.text);
  return { bodies: texts('body'), fields: texts('field') };
}

/** The remote image URLs among `columns`. */
export const remoteUrlsIn = (columns: ImageColumns): Set<string> =>
  new Set([
    ...columns.bodies.flatMap(remoteImageUrls),
    ...columns.fields.flatMap(remoteField)
  ]);

/** Every remote image URL that stored content still references. */
export const collectReferencedRemoteUrls = async (
  client: PrismaClient = prisma
): Promise<Set<string>> => remoteUrlsIn(await collectImageColumns(client));
