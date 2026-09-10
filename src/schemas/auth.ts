import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Please include a valid email'),
  password: z.string().min(1, 'Password is required')
});

export const registerSchema = z.object({
  username: z.string().min(1, 'Username is required').max(32),
  email: z.string().email('Please include a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  inviteKey: z.string().optional()
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters')
});

export const changeEmailSchema = z.object({
  newEmail: z.string().email('Please include a valid email'),
  password: z.string().min(1, 'Password is required')
});

export const recoveryRequestSchema = z.object({
  email: z.string().email('Please include a valid email')
});

export const recoveryResetSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters')
});

// Reactivation (#279). Deliberately the same shapes as the recovery pair — the
// two flows differ in what the token is FOR, not in what the client sends.
export const reactivationRequestSchema = z.object({
  email: z.string().email('Please include a valid email')
});

export const reactivationConfirmSchema = z.object({
  token: z.string().min(1, 'Token is required')
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ChangeEmailInput = z.infer<typeof changeEmailSchema>;
export type RecoveryRequestInput = z.infer<typeof recoveryRequestSchema>;
export type RecoveryResetInput = z.infer<typeof recoveryResetSchema>;
export type ReactivationRequestInput = z.infer<
  typeof reactivationRequestSchema
>;
export type ReactivationConfirmInput = z.infer<
  typeof reactivationConfirmSchema
>;
