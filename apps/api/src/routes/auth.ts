import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { GoogleOAuth, randomToken } from '../auth/google.js';
import { createSession, destroySession, newInviteCode } from '../auth/session.js';
import { db, schema } from '../db/index.js';
import { env } from '../env.js';
import { isBlockedEitherWay, makeFriends } from '../lib/friends.js';

const INVITE_COOKIE = 'zf_invite';
const tempCookie = { path: '/', httpOnly: true, secure: env.isProd, sameSite: 'lax' as const, maxAge: 600 };

interface Profile {
  googleSub: string | null;
  email: string | null;
  name: string;
  avatarUrl: string | null;
}

async function uniqueInviteCode(): Promise<string> {
  for (;;) {
    const code = newInviteCode();
    const taken = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.inviteCode, code))
      .limit(1);
    if (!taken.length) return code;
  }
}

/** Find or create the user; a new user who came through an invite link befriends the inviter. */
async function upsertUser(profile: Profile, inviteCode: string | undefined) {
  if (profile.googleSub) {
    const existing = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.googleSub, profile.googleSub))
      .limit(1);
    if (existing[0]) {
      const [updated] = await db
        .update(schema.users)
        .set({ name: profile.name, email: profile.email, avatarUrl: profile.avatarUrl })
        .where(eq(schema.users.id, existing[0].id))
        .returning();
      return updated!;
    }
  }
  const [user] = await db
    .insert(schema.users)
    .values({ ...profile, inviteCode: await uniqueInviteCode() })
    .returning();

  if (inviteCode) {
    const [inviter] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.inviteCode, inviteCode.toUpperCase()))
      .limit(1);
    if (inviter && !(await isBlockedEitherWay(inviter.id, user!.id))) {
      await makeFriends(inviter.id, user!.id);
    }
  }
  return user!;
}

export async function authRoutes(app: FastifyInstance) {
  const google = env.googleEnabled
    ? new GoogleOAuth(env.GOOGLE_CLIENT_ID!, env.GOOGLE_CLIENT_SECRET!, `${env.APP_ORIGIN}/api/auth/google/callback`)
    : null;

  app.get('/api/auth/providers', async () => ({ google: Boolean(google), devLogin: env.devLogin }));

  app.get('/api/auth/google', async (request, reply) => {
    if (!google) return reply.code(503).send({ error: 'google_not_configured' });
    const { invite } = z.object({ invite: z.string().max(20).optional() }).parse(request.query);
    const state = randomToken();
    const verifier = randomToken();
    const url = google.authorizationUrl(state, verifier);
    reply.setCookie('g_state', state, tempCookie);
    reply.setCookie('g_verifier', verifier, tempCookie);
    if (invite) reply.setCookie(INVITE_COOKIE, invite, tempCookie);
    return reply.redirect(url);
  });

  app.get('/api/auth/google/callback', async (request, reply) => {
    if (!google) return reply.code(503).send({ error: 'google_not_configured' });
    const { code, state } = z
      .object({ code: z.string(), state: z.string() })
      .parse(request.query);
    const savedState = request.cookies.g_state;
    const verifier = request.cookies.g_verifier;
    reply.clearCookie('g_state', { path: '/' });
    reply.clearCookie('g_verifier', { path: '/' });
    if (!savedState || !verifier || savedState !== state) {
      return reply.redirect(`${env.APP_ORIGIN}/?login=failed`);
    }
    let profile;
    try {
      profile = await google.exchange(code, verifier);
    } catch (err) {
      request.log.warn({ err }, 'google oauth failed');
      return reply.redirect(`${env.APP_ORIGIN}/?login=failed`);
    }
    const user = await upsertUser(
      {
        googleSub: profile.sub,
        email: profile.email,
        name: profile.name ?? 'مستخدم',
        avatarUrl: profile.picture
      },
      request.cookies[INVITE_COOKIE]
    );
    reply.clearCookie(INVITE_COOKIE, { path: '/' });
    await createSession(reply, user.id);
    return reply.redirect(`${env.APP_ORIGIN}${user.username ? '/?login=ok' : '/welcome'}`);
  });

  if (env.devLogin) {
    // Development only: sign in as a named local user without Google.
    app.post('/api/auth/dev-login', async (request, reply) => {
      const { name, invite } = z
        .object({ name: z.string().min(1).max(40), invite: z.string().max(20).optional() })
        .parse(request.body);
      const sub = `dev:${name}`;
      const user = await upsertUser({ googleSub: sub, email: null, name, avatarUrl: null }, invite);
      await createSession(reply, user.id);
      return { ok: true, needsUsername: !user.username };
    });
  }

  app.post('/api/auth/logout', async (request, reply) => {
    await destroySession(request, reply);
    return { ok: true };
  });
}
