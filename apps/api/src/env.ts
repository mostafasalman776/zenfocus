import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().default(5090),
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().default('./.pglite'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  DEV_LOGIN: z.string().optional(),
  UPLOAD_DIR: z.string().default('./uploads'),
  /** HMAC key for signed image URLs. */
  IMAGE_SECRET: z.preprocess((v) => v || undefined, z.string().min(32).optional()),
  /** When set (e.g. /_zf_uploads/), images are served by Nginx via X-Accel-Redirect. */
  ACCEL_REDIRECT_PREFIX: z.string().optional(),
  /** Platform admins: comma-separated usernames and/or Google emails. */
  ADMIN_USERNAMES: z.string().default(''),
  ADMIN_EMAILS: z.string().default(''),
  /** LiveKit (voice). Leave empty to disable voice. */
  LIVEKIT_URL: z.preprocess((v) => v || undefined, z.string().url().optional()),
  LIVEKIT_API_KEY: z.preprocess((v) => v || undefined, z.string().optional()),
  LIVEKIT_API_SECRET: z.preprocess((v) => v || undefined, z.string().optional())
});

const parsed = schema.parse(process.env);

export const env = {
  ...parsed,
  isProd: parsed.NODE_ENV === 'production',
  devLogin: parsed.NODE_ENV !== 'production' && parsed.DEV_LOGIN === '1',
  googleEnabled: Boolean(parsed.GOOGLE_CLIENT_ID && parsed.GOOGLE_CLIENT_SECRET),
  voiceEnabled: Boolean(parsed.LIVEKIT_URL && parsed.LIVEKIT_API_KEY && parsed.LIVEKIT_API_SECRET),
  imageSecret: parsed.IMAGE_SECRET ?? randomBytes(32).toString('hex'),
  admins: new Set(
    `${parsed.ADMIN_USERNAMES},${parsed.ADMIN_EMAILS}`
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  )
};

export function isAdminUser(u: { username: string | null; email: string | null }): boolean {
  return Boolean(
    (u.username && env.admins.has(u.username.toLowerCase())) || (u.email && env.admins.has(u.email.toLowerCase()))
  );
}

if (env.isProd && !env.DATABASE_URL) throw new Error('DATABASE_URL is required in production');
if (env.isProd && !parsed.IMAGE_SECRET) throw new Error('IMAGE_SECRET is required in production');
