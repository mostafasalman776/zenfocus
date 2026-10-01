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
  DEV_LOGIN: z.string().optional()
});

const parsed = schema.parse(process.env);

export const env = {
  ...parsed,
  isProd: parsed.NODE_ENV === 'production',
  devLogin: parsed.NODE_ENV !== 'production' && parsed.DEV_LOGIN === '1',
  googleEnabled: Boolean(parsed.GOOGLE_CLIENT_ID && parsed.GOOGLE_CLIENT_SECRET)
};

if (env.isProd && !env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required in production');
}
