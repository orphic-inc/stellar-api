import { z } from 'zod';

export const artistSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  vanityHouse: z.boolean().optional()
});

export const updateArtistSchema = z
  .object({
    name: z.string().min(1).optional(),
    vanityHouse: z.boolean().optional(),
    description: z.string().optional()
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

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

export type ArtistInput = z.infer<typeof artistSchema>;
export type UpdateArtistInput = z.infer<typeof updateArtistSchema>;
export type SimilarArtistInput = z.infer<typeof similarArtistSchema>;
export type ArtistAliasInput = z.infer<typeof artistAliasSchema>;
export type ArtistTagInput = z.infer<typeof artistTagSchema>;
