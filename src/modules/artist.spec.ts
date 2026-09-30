const prismaMock = {
  artist: {
    updateMany: jest.fn(),
    findUniqueOrThrow: jest.fn()
  },
  artistHistory: {
    create: jest.fn(),
    findUnique: jest.fn()
  },
  $transaction: jest.fn()
};

jest.mock('../lib/prisma', () => ({
  prisma: prismaMock
}));

import { revertArtistFromHistory, updateArtist } from './artist';

const artist = { id: 2, name: 'Miles Davis', vanityHouse: false };

beforeEach(() => {
  prismaMock.$transaction.mockImplementation(
    (cb: (tx: typeof prismaMock) => unknown) => cb(prismaMock)
  );
  prismaMock.artist.findUniqueOrThrow.mockResolvedValue(artist);
  prismaMock.artistHistory.create.mockResolvedValue({});
});

describe('updateArtist', () => {
  it('edits only a live artist, then records the history entry', async () => {
    prismaMock.artist.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      updateArtist(2, 7, { name: 'Miles Davis', description: 'fix' })
    ).resolves.toEqual(artist);

    expect(prismaMock.artist.updateMany).toHaveBeenCalledWith({
      where: { id: 2, deletedAt: null },
      data: { name: 'Miles Davis' }
    });
    expect(prismaMock.artistHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ artistId: 2, editedBy: 7 })
    });
  });

  it('404s when the artist was withdrawn after the route read it (#804)', async () => {
    prismaMock.artist.updateMany.mockResolvedValue({ count: 0 });

    await expect(updateArtist(2, 7, { name: 'Late' })).rejects.toMatchObject({
      statusCode: 404,
      message: 'Artist not found'
    });
    expect(prismaMock.artistHistory.create).not.toHaveBeenCalled();
  });
});

describe('revertArtistFromHistory', () => {
  const entry = { id: 11, artistId: 2, data: { name: 'Miles Davis' } };

  it('restores a live artist from the entry, then records the revert', async () => {
    prismaMock.artistHistory.findUnique.mockResolvedValue(entry);
    prismaMock.artist.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      revertArtistFromHistory({ historyId: 11, editedBy: 7 })
    ).resolves.toEqual(artist);

    expect(prismaMock.artist.updateMany).toHaveBeenCalledWith({
      where: { id: 2, deletedAt: null },
      data: { name: 'Miles Davis' }
    });
    expect(prismaMock.artistHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        artistId: 2,
        description: 'Reverted to history #11'
      })
    });
  });

  it('answers null, writing nothing, when the artist is withdrawn (#804)', async () => {
    prismaMock.artistHistory.findUnique.mockResolvedValue(entry);
    prismaMock.artist.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      revertArtistFromHistory({ historyId: 11, editedBy: 7 })
    ).resolves.toBeNull();
    expect(prismaMock.artistHistory.create).not.toHaveBeenCalled();
  });

  it('answers null when the entry is missing', async () => {
    prismaMock.artistHistory.findUnique.mockResolvedValue(null);

    await expect(
      revertArtistFromHistory({ historyId: 11, editedBy: 7 })
    ).resolves.toBeNull();
    expect(prismaMock.artist.updateMany).not.toHaveBeenCalled();
  });
});
