import { z } from 'zod';

export const featuredAlbumSchema = z.object({
  groupId: z.coerce.number().int().positive(),
  threadId: z.coerce.number().int().positive(),
  title: z.string().min(1).max(200),
  image: z.string().url().max(1000).optional().or(z.literal('')),
  started: z.string().datetime({ offset: true }),
  ended: z.string().datetime({ offset: true })
});

export type FeaturedAlbumInput = z.infer<typeof featuredAlbumSchema>;
