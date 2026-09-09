import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';

type ArtistHistorySnapshot = {
  name?: string;
  vanityHouse?: boolean;
};

/**
 * The `Artist.deletedAt` invariant as one call (#573).
 *
 * A soft-deleted artist keeps a live row, so a foreign key to it still
 * resolves and `findUnique({ where: { id } })` still finds it. Every surface
 * that treats an artist as a catalogue entry has to add `deletedAt: null`
 * itself, and four did not — `GET /{id}/similar`, `GET /history/{artistId}`
 * and both subscribe reads — because the sweep that added it to the direct
 * reads only looked at handlers naming `prisma.artist`.
 *
 * `onMissing` is a `[status, message]` tuple, the same shape
 * `translatePrismaError` takes, so a route keeps the answer it already gives
 * for the adjacent case. A path id defaults to `404`. The two POST bodies take
 * `[400, ...]` instead, because their ids arrive in the body and the route
 * itself exists (#564's rule) — and they already answer exactly that for a
 * dangling id, so a withdrawn one must not answer differently.
 */
export const assertArtistLive = async (
  id: number,
  onMissing: [number, string] = [404, 'Artist not found']
): Promise<void> => {
  const artist = await prisma.artist.findUnique({
    where: { id, deletedAt: null },
    select: { id: true }
  });
  if (!artist) throw new AppError(onMissing[0], onMissing[1]);
};

export const createArtist = async (
  name: string,
  vanityHouse: boolean,
  editorId: number
) => {
  const artist = await prisma.artist.create({
    data: { name, vanityHouse }
  });
  await createArtistHistoryEntry({
    artistId: artist.id,
    editedBy: editorId,
    snapshot: { name, vanityHouse }
  });
  return artist;
};

export const updateArtist = async (
  id: number,
  editorId: number,
  data: { name?: string; vanityHouse?: boolean; description?: string }
) =>
  prisma.$transaction(async (tx) => {
    const artist = await tx.artist.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.vanityHouse !== undefined && { vanityHouse: data.vanityHouse })
      }
    });
    await createArtistHistoryEntry({
      db: tx,
      artistId: id,
      editedBy: editorId,
      snapshot: { name: data.name, vanityHouse: data.vanityHouse },
      description: data.description
    });
    return artist;
  });

type ArtistHistoryWriter = {
  artistHistory: {
    create: typeof prisma.artistHistory.create;
  };
};

export const createArtistHistoryEntry = async ({
  db = prisma,
  artistId,
  editedBy,
  snapshot,
  description
}: {
  db?: ArtistHistoryWriter;
  artistId: number;
  editedBy: number;
  snapshot: ArtistHistorySnapshot;
  description?: string;
}) =>
  db.artistHistory.create({
    data: {
      artistId,
      editedBy,
      data: snapshot,
      ...(description !== undefined && { description })
    }
  });

export const revertArtistFromHistory = async ({
  historyId,
  editedBy
}: {
  historyId: number;
  editedBy: number;
}) => {
  const entry = await prisma.artistHistory.findUnique({
    where: { id: historyId }
  });
  if (!entry) return null;

  const data = entry.data as Record<string, unknown>;
  const artist = await prisma.artist.update({
    where: { id: entry.artistId },
    data: {
      ...(data.name !== undefined && { name: data.name as string }),
      ...(data.vanityHouse !== undefined && {
        vanityHouse: data.vanityHouse as boolean
      })
    }
  });

  await createArtistHistoryEntry({
    artistId: artist.id,
    editedBy,
    snapshot: { name: artist.name, vanityHouse: artist.vanityHouse },
    description: `Reverted to history #${historyId}`
  });

  return artist;
};
