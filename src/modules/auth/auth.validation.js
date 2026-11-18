const { z } = require('zod');

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Must be a valid email address').max(255));

// bcrypt only uses the first 72 bytes, so longer passwords are rejected rather than silently truncated.
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .refine((p) => Buffer.byteLength(p, 'utf8') <= 72, 'Password must be at most 72 bytes')
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain a letter and a number');

const token = z.string().trim().min(1, 'Token is required').max(200);

const registerSchema = z.object({
  email,
  password,
  name: z.string().trim().min(1, 'Name is required').max(100),
});

const loginSchema = z.object({
  email,
  // Don't apply the strength rules here; just require something.
  password: z.string().min(1, 'Password is required').max(1024),
});

const refreshSchema = z.object({
  // Browser clients use the httpOnly cookie; other clients may send it in the body.
  refreshToken: z.string().max(200).optional(),
});

const emailOnlySchema = z.object({ email });

const verifyEmailSchema = z.object({ token });

const resetPasswordSchema = z.object({ token, password });

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(1024),
  newPassword: password,
});

module.exports = {
  registerSchema,
  loginSchema,
  refreshSchema,
  emailOnlySchema,
  verifyEmailSchema,
  resetPasswordSchema,
  changePasswordSchema,
};
