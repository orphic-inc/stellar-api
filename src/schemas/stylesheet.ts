import { z } from 'zod';

export const stylesheetSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  cssUrl: z.string().min(1, 'CSS URL is required')
});
