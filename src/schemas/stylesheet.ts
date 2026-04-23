import { z } from 'zod';

export const stylesheetSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  cssUrl: z.string().url('CSS URL must be a valid URL')
});

export type StylesheetInput = z.infer<typeof stylesheetSchema>;
