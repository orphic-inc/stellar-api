import { z } from 'zod';

export const installSchema = z.object({
  username: z.string().min(1, 'Username is required').max(30),
  email: z.string().email('Please include a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters')
});

export type InstallInput = z.infer<typeof installSchema>;
