import { z } from 'zod';
import type { LoginRequest, RegisterRequest } from '@rag-ats/shared';

const credentials = z.object({
  email: z.string().trim().pipe(z.email('Enter a valid email')),
  password: z.string().min(8, 'Password must be at least 8 characters'),
}) satisfies z.ZodType<LoginRequest & RegisterRequest>;

export const loginSchema = credentials;

export type LoginFormValues = z.infer<typeof loginSchema>;

export const registerSchema = credentials
  .extend({ confirmPassword: z.string() })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type RegisterFormValues = z.infer<typeof registerSchema>;
