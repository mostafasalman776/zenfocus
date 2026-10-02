import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db, schema } from '../db/index.js';
import { env } from '../env.js';

export const SESSION_COOKIE = 'zf_session';
const SESSION_DAYS = 30;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export type User = typeof schema.users.$inferSelect;

export async function createSession(reply: FastifyReply, userId: string) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.insert(schema.authSessions).values({ id: hash(token), userId, expiresAt });
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: env.isProd,
    sameSite: 'lax',
    expires: expiresAt
  });
}

export async function userFromToken(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const rows = await db
    .select({ user: schema.users })
    .from(schema.authSessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.authSessions.userId))
    .where(
      and(
        eq(schema.authSessions.id, hash(token)),
        gt(schema.authSessions.expiresAt, new Date()),
        isNull(schema.users.bannedAt)
      )
    )
    .limit(1);
  return rows[0]?.user ?? null;
}

export async function destroySession(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[SESSION_COOKIE];
  if (token) await db.delete(schema.authSessions).where(eq(schema.authSessions.id, hash(token)));
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function newInviteCode(): string {
  // Unambiguous alphabet: no 0/O, 1/I/L.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(4);
  let code = '';
  for (const b of bytes) code += alphabet[b % alphabet.length];
  return `ZEN-${code}`;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
  }
}

/** Route guard: 401 unless signed in. */
export async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) return reply.code(401).send({ error: 'unauthorized' });
}

export function currentUser(request: FastifyRequest): User {
  if (!request.user) throw new Error('requireUser must run before this handler');
  return request.user;
}
