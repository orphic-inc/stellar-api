import { z } from 'zod';
import { httpImageUrl } from './imageUrl';

export const featuredAlbumSchema = z.object({
  groupId: z.coerce.number().int().positive(),
  threadId: z.coerce.number().int().positive(),
  title: z.string().min(1).max(200),
  image: httpImageUrl.max(1000).optional().or(z.literal('')),
  started: z.string().datetime({ offset: true }),
  ended: z.string().datetime({ offset: true })
});

export type FeaturedAlbumInput = z.infer<typeof featuredAlbumSchema>;
