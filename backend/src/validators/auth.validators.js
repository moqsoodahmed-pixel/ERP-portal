import { z } from 'zod';
import { emailSchema, passwordSchema } from './common.js';

export const loginBody = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).strict();
export const changePasswordBody = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }).strict();
