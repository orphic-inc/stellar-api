import { prisma } from '../lib/prisma';

type ArtistHistorySnapshot = {
  name?: string;
  vanityHouse?: boolean;
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
