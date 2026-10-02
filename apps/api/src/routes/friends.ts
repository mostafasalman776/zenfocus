import { USERNAME_RE, type FriendSummary, type FriendsPayload, type LeaderboardPeriod } from '@zenfocus/shared';
import { and, eq, inArray, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser, requireUser } from '../auth/session.js';
import { db, schema } from '../db/index.js';
import { leaderboard } from '../lib/aggregates.js';
import { areFriends, friendIds, isBlockedEitherWay, makeFriends, unfriend } from '../lib/friends.js';

const u = schema.users;
const fr = schema.friendRequests;

const summary = { userId: u.id, name: u.name, username: u.username, avatarUrl: u.avatarUrl };

export async function friendRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.get('/api/friends', async (request): Promise<FriendsPayload> => {
    const me = currentUser(request);
    const ids = await friendIds(me.id);
    const [friends, incoming, outgoing] = await Promise.all([
      ids.length ? db.select(summary).from(u).where(inArray(u.id, ids)) : Promise.resolve([] as FriendSummary[]),
      db
        .select({ ...summary, requestId: fr.id })
        .from(fr)
        .innerJoin(u, eq(u.id, fr.fromUserId))
        .where(eq(fr.toUserId, me.id)),
      db
        .select({ ...summary, requestId: fr.id })
        .from(fr)
        .innerJoin(u, eq(u.id, fr.toUserId))
        .where(eq(fr.fromUserId, me.id))
    ]);
    return { friends, incoming, outgoing };
  });

  /** Friends with a focus session running right now (for the "focusing now" badge). */
  app.get('/api/friends/focusing', async (request) => {
    const me = currentUser(request);
    const ids = await friendIds(me.id);
    if (!ids.length) return { friends: [] };
    const rows = await db
      .selectDistinct(summary)
      .from(schema.focusSessions)
      .innerJoin(u, eq(u.id, schema.focusSessions.userId))
      .where(and(inArray(schema.focusSessions.userId, ids), eq(schema.focusSessions.status, 'running')))
      .limit(20);
    return { friends: rows };
  });

  /** Send a request by username. If they already asked us, this accepts it. */
  app.post('/api/friends/requests', async (request, reply) => {
    const me = currentUser(request);
    const { username } = z
      .object({ username: z.string().trim().toLowerCase().transform((s) => s.replace(/^@/, '')).pipe(z.string().regex(USERNAME_RE)) })
      .parse(request.body);
    const [target] = await db.select({ id: u.id }).from(u).where(eq(u.username, username)).limit(1);
    // Same answer for "no such user" and "blocked" so blocks stay private.
    if (!target || target.id === me.id || (await isBlockedEitherWay(me.id, target.id))) {
      return reply.code(404).send({ error: 'user_not_found' });
    }
    if (await areFriends(me.id, target.id)) return { status: 'already_friends' };
    const [reverse] = await db
      .select({ id: fr.id })
      .from(fr)
      .where(and(eq(fr.fromUserId, target.id), eq(fr.toUserId, me.id)))
      .limit(1);
    if (reverse) {
      await makeFriends(me.id, target.id);
      return { status: 'friends' };
    }
    await db.insert(fr).values({ fromUserId: me.id, toUserId: target.id }).onConflictDoNothing();
    return { status: 'requested' };
  });

  app.post('/api/friends/requests/:id/accept', async (request, reply) => {
    const me = currentUser(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [req] = await db
      .select()
      .from(fr)
      .where(and(eq(fr.id, id), eq(fr.toUserId, me.id)))
      .limit(1);
    if (!req) return reply.code(404).send({ error: 'not_found' });
    await makeFriends(me.id, req.fromUserId);
    return { status: 'friends' };
  });

  /** Decline an incoming request or cancel an outgoing one. */
  app.delete('/api/friends/requests/:id', async (request) => {
    const me = currentUser(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await db.delete(fr).where(and(eq(fr.id, id), or(eq(fr.toUserId, me.id), eq(fr.fromUserId, me.id))));
    return { ok: true };
  });

  app.delete('/api/friends/:userId', async (request) => {
    const me = currentUser(request);
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    await unfriend(me.id, userId);
    return { ok: true };
  });

  app.post('/api/blocks/:userId', async (request) => {
    const me = currentUser(request);
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    if (userId === me.id) return { ok: true };
    await unfriend(me.id, userId);
    await db
      .delete(fr)
      .where(
        or(
          and(eq(fr.fromUserId, me.id), eq(fr.toUserId, userId)),
          and(eq(fr.fromUserId, userId), eq(fr.toUserId, me.id))
        )
      );
    await db.insert(schema.blocks).values({ userId: me.id, blockedId: userId }).onConflictDoNothing();
    return { ok: true };
  });

  app.delete('/api/blocks/:userId', async (request) => {
    const me = currentUser(request);
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    await db
      .delete(schema.blocks)
      .where(and(eq(schema.blocks.userId, me.id), eq(schema.blocks.blockedId, userId)));
    return { ok: true };
  });

  app.get('/api/leaderboard', async (request) => {
    const me = currentUser(request);
    const { period } = z
      .object({ period: z.enum(['week', 'month', 'all']).default('week') })
      .parse(request.query) as { period: LeaderboardPeriod };
    const ids = [me.id, ...(await friendIds(me.id))];
    return { period, rows: await leaderboard(me.id, ids, period) };
  });
}
