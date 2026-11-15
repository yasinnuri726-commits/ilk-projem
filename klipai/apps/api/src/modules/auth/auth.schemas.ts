// Yol: klipai/apps/api/src/modules/auth/auth.schemas.ts
import { z } from 'zod';

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254));
const password = z.string().min(10).max(128);
const timezone = z
  .string()
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Geçersiz saat dilimi');

export const RegisterSchema = z.strictObject({
  email,
  password,
  displayName: z.string().trim().min(1).max(80),
  locale: z.enum(['TR', 'EN']).optional(),
  timezone: timezone.optional(),
});
export const LoginSchema = z.strictObject({ email, password: z.string().min(1).max(128) });
export const GoogleSchema = z.strictObject({ idToken: z.string().min(20).max(4096) });
export const RefreshSchema = z.strictObject({ refreshToken: z.string().min(20).max(200) });
export const LogoutSchema = z.strictObject({
  refreshToken: z.string().min(20).max(200),
  allDevices: z.boolean().default(false),
});
export const TokenSchema = z.strictObject({ token: z.string().min(20).max(200) });
export const ForgotSchema = z.strictObject({ email });
export const ResetSchema = z.strictObject({ token: z.string().min(20).max(200), password });

export const UpdateMeSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(80).optional(),
  locale: z.enum(['TR', 'EN']).optional(),
  theme: z.enum(['SYSTEM', 'LIGHT', 'DARK']).optional(),
  timezone: timezone.optional(),
});
export const DeviceSchema = z.strictObject({
  platform: z.enum(['IOS', 'ANDROID']),
  pushToken: z.string().min(10).max(255),
  appVersion: z.string().max(32).optional(),
});
