import { prisma } from '../lib/prisma';

type ArtistHistorySnapshot = {
  name?: string;
  vanityHouse?: boolean;
};

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
