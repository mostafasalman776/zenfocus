import {
  USERNAME_RE,
  addDays,
  cairoDay,
  longestStreak,
  streakFrom,
  type Me,
  type StatsPayload,
  type TodaySummary
} from '@zenfocus/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser, requireUser, type User } from '../auth/session.js';
import { db, schema, tzSql } from '../db/index.js';
import { dailyTotals, leaderboard } from '../lib/aggregates.js';
import { friendIds } from '../lib/friends.js';

export const toMe = (u: User): Me => ({
  id: u.id,
  name: u.name,
  username: u.username,
  avatarUrl: u.avatarUrl,
  inviteCode: u.inviteCode
});

const fs = schema.focusSessions;

export async function meRoutes(app: FastifyInstance) {
  app.get('/api/me', async (request) => ({ me: request.user ? toMe(request.user) : null }));

  app.patch('/api/me', { preHandler: requireUser }, async (request, reply) => {
    const user = currentUser(request);
    const body = z
      .object({
        username: z.string().trim().toLowerCase().regex(USERNAME_RE).optional(),
        name: z.string().trim().min(1).max(40).optional(),
        dailyGoalSeconds: z.number().int().min(15 * 60).max(16 * 3600).optional()
      })
      .parse(request.body);
    if (body.username && body.username !== user.username) {
      const taken = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.username, body.username))
        .limit(1);
      if (taken.length) return reply.code(409).send({ error: 'username_taken' });
    }
    const [updated] = await db
      .update(schema.users)
      .set(body)
      .where(eq(schema.users.id, user.id))
      .returning();
    return { me: toMe(updated!) };
  });

  app.get('/api/me/today', { preHandler: requireUser }, async (request): Promise<TodaySummary> => {
    const user = currentUser(request);
    const today = cairoDay(new Date());
    const friends = await friendIds(user.id);
    const [days, sessionsToday, board] = await Promise.all([
      dailyTotals([user.id], addDays(today, -400), { includeImported: true }),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(fs)
        .where(
          and(
            eq(fs.userId, user.id),
            eq(fs.completed, true),
            sql`(${fs.startedAt} at time zone ${tzSql})::date = ${today}::date`
          )
        ),
      friends.length ? leaderboard(user.id, [user.id, ...friends], 'week') : Promise.resolve([])
    ]);
    const mine = days.get(user.id) ?? {};
    const rankIdx = board.findIndex((r) => r.isMe);
    return {
      seconds: mine[today] ?? 0,
      sessions: sessionsToday[0]?.n ?? 0,
      goalSeconds: user.dailyGoalSeconds,
      streak: streakFrom(mine, today),
      rank: rankIdx >= 0 ? rankIdx + 1 : null,
      friendsCount: friends.length
    };
  });

  app.get('/api/me/stats', { preHandler: requireUser }, async (request): Promise<StatsPayload> => {
    const user = currentUser(request);
    const today = cairoDay(new Date());
    const [allDays, totals, tags] = await Promise.all([
      dailyTotals([user.id], null, { includeImported: true }),
      db
        .select({
          seconds: sql<number>`coalesce(sum(${fs.creditedSeconds}), 0)::int`,
          sessions: sql<number>`(count(*) filter (where ${fs.completed}))::int`
        })
        .from(fs)
        .where(eq(fs.userId, user.id)),
      db
        .select({
          tag: sql<string>`coalesce(${fs.tag}, '')`,
          seconds: sql<number>`sum(${fs.creditedSeconds})::int`
        })
        .from(fs)
        .where(and(eq(fs.userId, user.id), sql`${fs.creditedSeconds} > 0`))
        .groupBy(sql`coalesce(${fs.tag}, '')`)
    ]);
    const days = allDays.get(user.id) ?? {};
    const from = addDays(today, -181);
    const recent: Record<string, number> = {};
    for (const [d, s] of Object.entries(days)) if (d >= from) recent[d] = s;
    const activeDays = Object.keys(days).length;
    const totalSeconds = totals[0]?.seconds ?? 0;
    return {
      totalSeconds,
      sessions: totals[0]?.sessions ?? 0,
      longestStreak: longestStreak(days),
      currentStreak: streakFrom(days, today),
      dailyAverageSeconds: activeDays ? Math.round(totalSeconds / activeDays) : 0,
      days: recent,
      tags: tags
        .map((t) => ({ tag: t.tag || 'بدون تصنيف', seconds: t.seconds }))
        .sort((a, b) => b.seconds - a.seconds)
    };
  });

  app.delete('/api/me', { preHandler: requireUser }, async (request, reply) => {
    const user = currentUser(request);
    await db.delete(schema.users).where(eq(schema.users.id, user.id));
    reply.clearCookie('zf_session', { path: '/' });
    return { ok: true };
  });
}

