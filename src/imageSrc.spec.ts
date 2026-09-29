/**
 * The `*Src` sibling of every image field (#737 slice 3, ADR-0051): what a
 * browser may load, which is never a remote URL.
 */
import { mockDeep, mockReset } from 'jest-mock-extended';
import type { PrismaClient } from '@prisma/client';

const prismaMock = mockDeep<PrismaClient>();
jest.mock('./lib/prisma', () => ({ prisma: prismaMock }));

import { addImageSrcs } from './modules/imageSrc';

const HASH = 'a'.repeat(64);
const UPLOAD = `/api/asset/${HASH}`;
const IMPORTED = 'https://images.example/imported.png';
const IMPORTED_ASSET = `/api/asset/${'b'.repeat(64)}`;
const PENDING = 'https://images.example/pending.png';

beforeEach(() => {
  mockReset(prismaMock);
  // Only the imported URL has an asset; the lookup filters on status itself.
  prismaMock.remoteImage.findMany.mockResolvedValue([
    { url: IMPORTED, assetHash: 'b'.repeat(64) }
  ] as never);
});

const resolved = async <T>(payload: T): Promise<T> => {
  await addImageSrcs(payload);
  return payload;
};

// Module scope, not inside `describe`: Lizard counts a describe callback as one
// function, and a table there grows it.
const CASES: [string, string | null, string | null][] = [
  ['an uploaded asset, as is', UPLOAD, UPLOAD],
  [
    'a path on this origin, as is',
    '/images/defaults/music.png',
    '/images/defaults/music.png'
  ],
  ['a protocol-relative URL, as null', '//evil.example/a.png', null],
  ['a backslash protocol-relative URL, as null', '/\\evil.example/a.png', null],
  [
    'a path a browser would read as //host, as null',
    '/\t/evil.example/a.png',
    null
  ],
  ['an imported remote URL, as its asset', IMPORTED, IMPORTED_ASSET],
  ['a remote URL not yet imported, as null', PENDING, null],
  ['an empty value, as null', '', null],
  ['a null value, as null', null, null],
  ['a value that is not a URL, as null', 'seeded', null]
];

describe('addImageSrcs', () => {
  it.each(CASES)('resolves %s', async (_name, raw, src) => {
    expect(await resolved({ avatar: raw })).toEqual({
      avatar: raw,
      avatarSrc: src
    });
  });

  it('covers every image field, nested at any depth, in one lookup', async () => {
    const body = await resolved({
      data: [
        { author: { avatar: IMPORTED }, image: PENDING },
        { rewards: { customIcon: UPLOAD, secondAvatar: IMPORTED } }
      ]
    });

    expect(body.data[0]).toEqual({
      author: { avatar: IMPORTED, avatarSrc: IMPORTED_ASSET },
      image: PENDING,
      imageSrc: null
    });
    expect(body.data[1].rewards).toEqual({
      customIcon: UPLOAD,
      customIconSrc: UPLOAD,
      secondAvatar: IMPORTED,
      secondAvatarSrc: IMPORTED_ASSET
    });
    expect(prismaMock.remoteImage.findMany).toHaveBeenCalledTimes(1);
  });

  it('resolves an image list, dropping what is not imported', async () => {
    expect(
      await resolved({ coverImages: [IMPORTED, PENDING, UPLOAD] })
    ).toEqual({
      coverImages: [IMPORTED, PENDING, UPLOAD],
      coverImagesSrc: [IMPORTED_ASSET, UPLOAD]
    });
  });

  it('leaves a list that does not hold strings alone', async () => {
    const body = await resolved({ coverImages: [{ image: 1 }] });
    expect(body).toEqual({ coverImages: [{ image: 1 }] });
  });

  it('leaves a key that does not hold a string alone', async () => {
    const body = await resolved({ image: { type: 'string' }, avatar: 3 });
    expect(body).toEqual({ image: { type: 'string' }, avatar: 3 });
  });

  it('asks the database nothing when no value is a remote URL', async () => {
    await resolved({ avatar: UPLOAD, image: null });
    expect(prismaMock.remoteImage.findMany).not.toHaveBeenCalled();
  });

  it('fails closed: a failed lookup leaves every remote image null', async () => {
    prismaMock.remoteImage.findMany.mockRejectedValue(new Error('db down'));
    expect(await resolved({ avatar: IMPORTED, image: UPLOAD })).toEqual({
      avatar: IMPORTED,
      avatarSrc: null,
      image: UPLOAD,
      imageSrc: UPLOAD
    });
  });

  it('does not walk into class instances such as dates', async () => {
    const when = new Date('2026-01-01');
    expect(await resolved({ when })).toEqual({ when });
  });
});
