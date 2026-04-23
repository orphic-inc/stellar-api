import { z } from 'zod';

export const artistSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  vanityHouse: z.boolean().optional()
});

export const similarArtistSchema = z.object({
  artistId: z.number().int().positive(),
  similarArtistId: z.number().int().positive()
});

export const artistAliasSchema = z.object({
  artistId: z.number().int().positive(),
  redirectId: z.number().int().positive()
});

export const artistTagSchema = z.object({
  artistId: z.number().int().positive(),
  tagId: z.number().int().positive()
});
