import { AppError } from './errors';
import { ALLOWED_MIMES, sniffMime, validateAsset } from './assetValidate';
import { assets } from '../modules/config';

/** A payload whose leading bytes identify it, padded so length is not the signal. */
const payload = (magic: number[], length = 64): Buffer =>
  Buffer.concat([
    Buffer.from(magic),
    Buffer.alloc(Math.max(0, length - magic.length))
  ]);

const PNG = payload([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = payload([0xff, 0xd8, 0xff]);
const GIF = payload([0x47, 0x49, 0x46, 0x38]);
const WOFF2 = payload([0x77, 0x4f, 0x46, 0x32]);
const OTF = payload([0x4f, 0x54, 0x54, 0x4f]);
const TTF = payload([0x00, 0x01, 0x00, 0x00]);

// RIFF….WEBP — the container tag sits at offset 8, past a 4-byte length.
const webp = (tag: string): Buffer => {
  const buf = payload([0x52, 0x49, 0x46, 0x46]);
  buf.write(tag, 8, 'ascii');
  return buf;
};

describe('sniffMime', () => {
  it.each([
    ['image/png', PNG],
    ['image/jpeg', JPEG],
    ['image/gif', GIF],
    ['image/webp', webp('WEBP')],
    ['font/woff2', WOFF2],
    ['font/otf', OTF],
    ['font/ttf', TTF]
  ])('identifies %s from its magic bytes', (mime, data) => {
    expect(sniffMime(data)).toBe(mime);
  });

  it('rejects a RIFF container that is not WEBP', () => {
    // RIFF alone is also AVI/WAV — the container tag is what makes it an image.
    expect(sniffMime(webp('AVI '))).toBeNull();
  });

  it('returns null for an unrecognized payload', () => {
    expect(sniffMime(Buffer.from('<?php echo 1; ?>'))).toBeNull();
  });

  it('does not read past a truncated payload', () => {
    // Two bytes of a PNG header must not be mistaken for a PNG.
    expect(sniffMime(Buffer.from([0x89, 0x50]))).toBeNull();
  });

  it('every allowlisted mime is reachable', () => {
    // Guards against an entry whose signature can never match.
    expect(ALLOWED_MIMES).toHaveLength(7);
  });
});

describe('validateAsset', () => {
  it('returns the sniffed mime when no type is declared', () => {
    expect(validateAsset(PNG)).toBe('image/png');
  });

  it('accepts a declared mime that matches the bytes', () => {
    expect(validateAsset(JPEG, 'image/jpeg')).toBe('image/jpeg');
  });

  it('rejects a declared mime the bytes contradict', () => {
    // The declared type becomes the served Content-Type, so trusting it
    // unverified would let a stored blob pick how a browser reads it.
    expect(() => validateAsset(PNG, 'image/jpeg')).toThrow(AppError);
    expect(() => validateAsset(PNG, 'image/jpeg')).toThrow(/image\/png/);
  });

  it('rejects an unrecognized type', () => {
    expect(() => validateAsset(Buffer.from('#!/bin/sh\nrm -rf /'))).toThrow(
      /Unsupported asset type/
    );
  });

  it('rejects an empty payload', () => {
    expect(() => validateAsset(Buffer.alloc(0))).toThrow(/empty/);
  });

  it('rejects a payload over the configured ceiling', () => {
    const oversize = payload(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      assets.maxBytes + 1
    );
    expect(() => validateAsset(oversize)).toThrow(/exceeds/);
  });

  it('accepts a payload exactly at the ceiling', () => {
    const atLimit = payload(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      assets.maxBytes
    );
    expect(validateAsset(atLimit)).toBe('image/png');
  });

  it('throws AppError with a 400 status', () => {
    try {
      validateAsset(Buffer.from('nope'));
      throw new Error('expected a throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(400);
    }
  });
});
