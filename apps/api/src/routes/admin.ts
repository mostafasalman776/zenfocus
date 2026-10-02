import { addDays, cairoDay, type AdminOverview, type AdminRoom, type AdminUser } from '@zenfocus/shared';
import { and, desc, eq, gte, ilike, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser, requireUser } from '../auth/session.js';
import { db, schema, tzSql } from '../db/index.js';
import { isAdminUser } from '../env.js';
import { disconnectUser, evict, onlineCount, presentCount } from '../realtime/hub.js';
import { purgeRoomImages } from '../rooms/images.js';
import { removeFromVoice } from '../rooms/voice.js';

const { users: u, focusSessions: fs, rooms, roomMembers: rm, messages: m, images, reports } = schema;
const idParam = z.object({ id: z.string().uuid() });
const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
const count = sql<number>`count(*)::int`;
const cairoDate = (col: unknown) => sql`(${col} at time zone ${tzSql})::date`;

async function deleteRoom(id: string) {
  await evict(id, null);
  await removeFromVoice(id, null);
  await purgeRoomImages(id);
  await db.delete(rooms).where(eq(rooms.id, id));
}

export async function adminRoutes(app: FastifyInstance) {
  app.register(async (admin) => {
    admin.addHook('preHandler', requireUser);
    admin.addHook('preHandler', async (request, reply) => {
      if (!isAdminUser(currentUser(request))) return reply.code(403).send({ error: 'forbidden' });
    });

    admin.get('/api/admin/overview', async (): Promise<AdminOverview> => {
      const now = Date.now();
      const ago = (days: number) => new Date(now - days * 86400_000);
      const today = cairoDay(new Date());
      const from = addDays(today, -29);
      const activeSince = (days: number) =>
        db.select({ n: sql<number>`count(distinct ${fs.userId})::int` }).from(fs).where(gte(fs.lastHeartbeatAt, ago(days)));

      const [
        [userTotals],
        [focusTotals],
        [focusingNow],
        [activeToday],
        [active7d],
        [active30d],
        [roomTotals],
        [messageTotals],
        [imageTotals],
        [openReports],
        signups,
        focusDays
      ] = await Promise.all([
        db
          .select({
            total: count,
            new1d: sql<number>`(count(*) filter (where ${u.createdAt} >= ${ago(1)}))::int`,
            new7d: sql<number>`(count(*) filter (where ${u.createdAt} >= ${ago(7)}))::int`,
            new30d: sql<number>`(count(*) filter (where ${u.createdAt} >= ${ago(30)}))::int`,
            banned: sql<number>`(count(*) filter (where ${u.bannedAt} is not null))::int`
          })
          .from(u),
        db
          .select({
            totalSeconds: sql<number>`coalesce(sum(${fs.creditedSeconds}), 0)::int`,
            sessions: sql<number>`(count(*) filter (where ${fs.completed}))::int`,
            todaySeconds: sql<number>`coalesce(sum(${fs.creditedSeconds}) filter (where ${cairoDate(fs.startedAt)} = ${today}::date), 0)::int`
          })
          .from(fs)
          .where(eq(fs.imported, false)),
        db.select({ n: count }).from(fs).where(eq(fs.status, 'running')),
        db
          .select({ n: sql<number>`count(distinct ${fs.userId})::int` })
          .from(fs)
          .where(sql`${cairoDate(fs.lastHeartbeatAt)} = ${today}::date`),
        activeSince(7),
        activeSince(30),
        db.select({ n: count }).from(rooms),
        db
          .select({
            n: count,
            today: sql<number>`(count(*) filter (where ${cairoDate(m.createdAt)} = ${today}::date))::int`
          })
          .from(m)
          .where(isNotNull(m.userId)),
        db
          .select({
            n: count,
            bytes: sql<number>`coalesce(sum(${images.bytes}), 0)::bigint`,
            originalBytes: sql<number>`coalesce(sum(${images.originalBytes}), 0)::bigint`
          })
          .from(images),
        db.select({ n: count }).from(reports).where(isNull(reports.resolvedAt)),
        db
          .select({ day: sql<string>`${cairoDate(u.createdAt)}::text`, n: count })
          .from(u)
          .where(sql`${cairoDate(u.createdAt)} >= ${from}::date`)
          .groupBy(cairoDate(u.createdAt)),
        db
          .select({
            day: sql<string>`${cairoDate(fs.startedAt)}::text`,
            seconds: sql<number>`coalesce(sum(${fs.creditedSeconds}), 0)::int`,
            users: sql<number>`count(distinct ${fs.userId})::int`
          })
          .from(fs)
          .where(and(eq(fs.imported, false), sql`${cairoDate(fs.startedAt)} >= ${from}::date`))
          .groupBy(cairoDate(fs.startedAt))
      ]);

      const signupMap = new Map(signups.map((r) => [r.day, r.n]));
      const focusMap = new Map(focusDays.map((r) => [r.day, r]));
      const daily = Array.from({ length: 30 }, (_, i) => {
        const day = addDays(from, i);
        return {
          day,
          signups: signupMap.get(day) ?? 0,
          focusSeconds: focusMap.get(day)?.seconds ?? 0,
          activeUsers: focusMap.get(day)?.users ?? 0
        };
      });

      return {
        users: userTotals!,
        activity: {
          onlineNow: onlineCount(),
          focusingNow: focusingNow!.n,
          activeToday: activeToday!.n,
          active7d: active7d!.n,
          active30d: active30d!.n
        },
        focus: focusTotals!,
        rooms: { total: roomTotals!.n, messages: messageTotals!.n, messagesToday: messageTotals!.today },
        images: { count: imageTotals!.n, bytes: Number(imageTotals!.bytes), originalBytes: Number(imageTotals!.originalBytes) },
        openReports: openReports!.n,
        daily
      };
    });

    admin.get('/api/admin/users', async (request): Promise<{ users: AdminUser[]; total: number }> => {
      const { q, offset } = z
        .object({ q: z.string().trim().max(80).default(''), offset: z.coerce.number().int().min(0).default(0) })
        .parse(request.query);
      const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
      const where = q ? or(ilike(u.name, like), ilike(u.username, like), ilike(u.email, like)) : undefined;
      const [rows, [total]] = await Promise.all([
        db
          .select({
            id: u.id,
            name: u.name,
            username: u.username,
            email: u.email,
            avatarUrl: u.avatarUrl,
            createdAt: u.createdAt,
            bannedAt: u.bannedAt,
            totalSeconds: sql<number>`coalesce((select sum(f.credited_seconds) from focus_sessions f where f.user_id = "users"."id" and not f.imported), 0)::int`,
            sessions: sql<number>`(select count(*) from focus_sessions f where f.user_id = "users"."id" and f.completed and not f.imported)::int`,
            lastActiveAt: sql<string | null>`greatest(
              (select max(f.last_heartbeat_at) from focus_sessions f where f.user_id = "users"."id"),
              (select max(a.created_at) from auth_sessions a where a.user_id = "users"."id")
            )`
          })
          .from(u)
          .where(where)
          .orderBy(desc(u.createdAt))
          .limit(50)
          .offset(offset),
        db.select({ n: count }).from(u).where(where)
      ]);
      return {
        total: total!.n,
        users: rows.map((r) => ({
          ...r,
          createdAt: iso(r.createdAt)!,
          bannedAt: iso(r.bannedAt),
          lastActiveAt: iso(r.lastActiveAt),
          isAdmin: isAdminUser(r)
        }))
      };
    });

    admin.post('/api/admin/users/:id/ban', async (request, reply) => {
      const { id } = idParam.parse(request.params);
      const { banned } = z.object({ banned: z.boolean() }).parse(request.body);
      const [target] = await db.select().from(u).where(eq(u.id, id)).limit(1);
      if (!target) return reply.code(404).send({ error: 'not_found' });
      if (isAdminUser(target)) return reply.code(400).send({ error: 'cannot_ban_admin' });
      await db.update(u).set({ bannedAt: banned ? new Date() : null }).where(eq(u.id, id));
      if (banned) {
        await db.delete(schema.authSessions).where(eq(schema.authSessions.userId, id));
        await disconnectUser(id);
      }
      return { ok: true };
    });

    admin.delete('/api/admin/users/:id', async (request, reply) => {
      const { id } = idParam.parse(request.params);
      const [target] = await db.select().from(u).where(eq(u.id, id)).limit(1);
      if (!target) return reply.code(404).send({ error: 'not_found' });
      if (isAdminUser(target)) return reply.code(400).send({ error: 'cannot_delete_admin' });
      const owned = await db.select({ id: rooms.id }).from(rooms).where(eq(rooms.ownerId, id));
      for (const r of owned) await deleteRoom(r.id);
      await disconnectUser(id);
      await db.delete(u).where(eq(u.id, id));
      return { ok: true };
    });

    admin.get('/api/admin/rooms', async (): Promise<{ rooms: AdminRoom[] }> => {
      const rows = await db
        .select({
          id: rooms.id,
          name: rooms.name,
          ownerName: u.name,
          createdAt: rooms.createdAt,
          members: sql<number>`(select count(*) from ${rm} where ${rm.roomId} = ${rooms.id})::int`,
          messages: sql<number>`(select count(*) from ${m} where ${m.roomId} = ${rooms.id} and ${m.userId} is not null)::int`
        })
        .from(rooms)
        .innerJoin(u, eq(u.id, rooms.ownerId))
        .orderBy(desc(rooms.createdAt))
        .limit(200);
      return {
        rooms: rows
          .map((r) => ({ ...r, createdAt: iso(r.createdAt)!, liveNow: presentCount(r.id) }))
          .sort((a, b) => b.liveNow - a.liveNow)
      };
    });

    admin.delete('/api/admin/rooms/:id', async (request) => {
      const { id } = idParam.parse(request.params);
      await deleteRoom(id);
      return { ok: true };
    });
  });
}
