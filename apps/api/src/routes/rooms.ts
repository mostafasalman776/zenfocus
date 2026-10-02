import { ROOM_RULES, roomPhase, type LeaderboardPeriod } from '@zenfocus/shared';
import multipart from '@fastify/multipart';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { currentUser, newInviteCode, requireUser } from '../auth/session.js';
import { db, schema } from '../db/index.js';
import { env, isAdminUser } from '../env.js';
import { leaderboard } from '../lib/aggregates.js';
import { emitRoom, evict } from '../realtime/hub.js';
import { BadImage, imageFile, purgeRoomImages, storeImage, verifySignature } from '../rooms/images.js';
import { removeFromVoice, voiceToken } from '../rooms/voice.js';
import {
  allow,
  getMessage,
  listMessages,
  memberIds,
  membership,
  postMessage,
  roomDetail,
  roomsOf,
  systemMessage,
  timerOf
} from '../rooms/service.js';

const { rooms, roomMembers: rm, messages: m } = schema;
const idParam = z.object({ id: z.string().uuid() });

async function uniqueRoomCode(): Promise<string> {
  for (;;) {
    const code = newInviteCode().replace('ZEN-', 'ROOM-');
    const taken = await db.select({ id: rooms.id }).from(rooms).where(eq(rooms.inviteCode, code)).limit(1);
    if (!taken.length) return code;
  }
}

const notMember = (reply: FastifyReply) => reply.code(404).send({ error: 'room_not_found' });

export async function roomRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: ROOM_RULES.imageMaxBytes, files: 1, fields: 2 } });

  // Images are fetched by <img> tags; the signed URL is the access check.
  app.get('/api/images/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const q = z.object({ exp: z.coerce.number(), sig: z.string() }).parse(request.query);
    if (!verifySignature(id, q.exp, q.sig)) return reply.code(403).send({ error: 'forbidden' });
    const [img] = await db.select().from(schema.images).where(eq(schema.images.id, id)).limit(1);
    if (!img) return reply.code(404).send({ error: 'expired' });
    const file = imageFile(img.path);
    reply.header('cache-control', 'private, max-age=21600, immutable');
    reply.header('content-type', 'image/webp');
    reply.header('x-content-type-options', 'nosniff');
    if (file.accelPath) return reply.header('x-accel-redirect', file.accelPath).send();
    return reply.send(file.stream());
  });

  app.register(async (auth) => {
    auth.addHook('preHandler', requireUser);

    auth.get('/api/rooms', async (request) => ({ rooms: await roomsOf(currentUser(request).id) }));

    auth.post('/api/rooms', async (request, reply) => {
      const me = currentUser(request);
      const { name } = z.object({ name: z.string().trim().min(1).max(ROOM_RULES.nameMax) }).parse(request.body);
      const [owned] = await db.select({ n: sql<number>`count(*)::int` }).from(rooms).where(eq(rooms.ownerId, me.id));
      if ((owned?.n ?? 0) >= ROOM_RULES.maxOwnedRooms) return reply.code(422).send({ error: 'too_many_rooms' });
      const [room] = await db.insert(rooms).values({ name, ownerId: me.id, inviteCode: await uniqueRoomCode() }).returning();
      await db.insert(rm).values({ roomId: room!.id, userId: me.id, role: 'owner' });
      await systemMessage(room!.id, `أنشأ ${me.name} الغرفة`);
      return { room: await roomDetail(room!, 'owner') };
    });

    auth.get('/api/rooms/:id', async (request, reply) => {
      const { id } = idParam.parse(request.params);
      const mem = await membership(id, currentUser(request).id);
      if (!mem) return notMember(reply);
      return { room: await roomDetail(mem.room, mem.role) };
    });

    auth.patch('/api/rooms/:id', async (request, reply) => {
      const { id } = idParam.parse(request.params);
      const mem = await membership(id, currentUser(request).id);
      if (!mem) return notMember(reply);
      if (mem.role !== 'owner') return reply.code(403).send({ error: 'owner_only' });
      const body = z
        .object({
          name: z.string().trim().min(1).max(ROOM_RULES.nameMax).optional(),
          focusMinutes: z.number().int().min(5).max(180).optional(),
          breakMinutes: z.number().int().min(1).max(60).optional()
        })
        .parse(request.body);
      const durationsChanged = body.focusMinutes !== undefined || body.breakMinutes !== undefined;
      const [room] = await db
        .update(rooms)
        .set({ ...body, ...(durationsChanged ? { timerRunning: false, timerStartedAt: null, timerElapsedSeconds: 0 } : {}) })
        .where(eq(rooms.id, id))
        .returning();
      emitRoom(id, 'room:updated', { name: room!.name });
      if (durationsChanged) emitRoom(id, 'room:timer', timerOf(room!));
      return { room: await roomDetail(room!, 'owner') };
    });

    auth.delete('/api/rooms/:id', async (request, reply) => {
      const { id } = idParam.parse(request.params);
      const mem = await membership(id, currentUser(request).id);
      if (!mem) return notMember(reply);
      if (mem.role !== 'owner') return reply.code(403).send({ error: 'owner_only' });
      await evict(id, null);
      await removeFromVoice(id, null);
      await purgeRoomImages(id);
      await db.delete(rooms).where(eq(rooms.id, id));
      return { ok: true };
    });

    auth.post('/api/rooms/:id/invite', async (request, reply) => {
      const { id } = idParam.parse(request.params);
      const mem = await membership(id, currentUser(request).id);
      if (!mem) return notMember(reply);
      if (mem.role !== 'owner') return reply.code(403).send({ error: 'owner_only' });
      const [room] = await db.update(rooms).set({ inviteCode: await uniqueRoomCode() }).where(eq(rooms.id, id)).returning();
      return { inviteCode: room!.inviteCode };
    });

    auth.get('/api/rooms/invite/:code', async (request, reply) => {
      const { code } = z.object({ code: z.string().max(20) }).parse(request.params);
      const [room] = await db.select().from(rooms).where(eq(rooms.inviteCode, code.toUpperCase())).limit(1);
      if (!room) return reply.code(404).send({ error: 'invalid_invite' });
      const ids = await memberIds(room.id);
      return {
        roomId: room.id,
        name: room.name,
        memberCount: ids.length,
        isMember: ids.includes(currentUser(request).id),
        full: ids.length >= ROOM_RULES.maxMembers
      };
    });

    auth.post('/api/rooms/join', async (request, reply) => {
      const me = currentUser(request);
      const { code } = z.object({ code: z.string().max(20) }).parse(request.body);
      const [room] = await db.select().from(rooms).where(eq(rooms.inviteCode, code.toUpperCase())).limit(1);
      if (!room) return reply.code(404).send({ error: 'invalid_invite' });
      const ids = await memberIds(room.id);
      if (!ids.includes(me.id)) {
        if (ids.length >= ROOM_RULES.maxMembers) return reply.code(422).send({ error: 'room_full' });
        await db.insert(rm).values({ roomId: room.id, userId: me.id, role: 'member' }).onConflictDoNothing();
        await systemMessage(room.id, `انضم ${me.name} إلى الغرفة`);
        emitRoom(room.id, 'room:members', {});
      }
      return { roomId: room.id };
    });

    auth.post('/api/rooms/:id/leave', async (request, reply) => {
      const me = currentUser(request);
      const { id } = idParam.parse(request.params);
      const mem = await membership(id, me.id);
      if (!mem) return notMember(reply);
      if (mem.role === 'owner') return reply.code(422).send({ error: 'owner_cannot_leave' });
      await db.delete(rm).where(and(eq(rm.roomId, id), eq(rm.userId, me.id)));
      await evict(id, me.id);
      await removeFromVoice(id, me.id);
      await systemMessage(id, `غادر ${me.name} الغرفة`);
      emitRoom(id, 'room:members', {});
      return { ok: true };
    });

    auth.delete('/api/rooms/:id/members/:userId', async (request, reply) => {
      const me = currentUser(request);
      const { id, userId } = z.object({ id: z.string().uuid(), userId: z.string().uuid() }).parse(request.params);
      const mem = await membership(id, me.id);
      if (!mem) return notMember(reply);
      if (mem.role !== 'owner' || userId === me.id) return reply.code(403).send({ error: 'owner_only' });
      const removed = await db.delete(rm).where(and(eq(rm.roomId, id), eq(rm.userId, userId))).returning();
      if (removed.length) {
        await evict(id, userId);
        await removeFromVoice(id, userId);
        emitRoom(id, 'room:members', {});
      }
      return { ok: true };
    });

    auth.post('/api/rooms/:id/timer', async (request, reply) => {
      const { id } = idParam.parse(request.params);
      const mem = await membership(id, currentUser(request).id);
      if (!mem) return notMember(reply);
      if (mem.role !== 'owner') return reply.code(403).send({ error: 'owner_only' });
      const { action } = z.object({ action: z.enum(['start', 'pause', 'reset', 'skip']) }).parse(request.body);
      const room = mem.room;
      const now = Date.now();
      const running = room.timerRunning && room.timerStartedAt ? Math.floor((now - room.timerStartedAt.getTime()) / 1000) : 0;
      const elapsed = room.timerElapsedSeconds + running;
      let patch: Partial<typeof rooms.$inferInsert>;
      if (action === 'start') patch = room.timerRunning ? {} : { timerRunning: true, timerStartedAt: new Date(now) };
      else if (action === 'pause') patch = { timerRunning: false, timerStartedAt: null, timerElapsedSeconds: elapsed };
      else if (action === 'reset') patch = { timerRunning: false, timerStartedAt: null, timerElapsedSeconds: 0 };
      else {
        const phase = roomPhase(timerOf(room), now);
        patch = {
          timerElapsedSeconds: elapsed + phase.remaining,
          timerStartedAt: room.timerRunning ? new Date(now) : null
        };
      }
      const [updated] = Object.keys(patch).length
        ? await db.update(rooms).set(patch).where(eq(rooms.id, id)).returning()
        : [room];
      const timer = timerOf(updated!);
      emitRoom(id, 'room:timer', timer);
      return { timer };
    });

    auth.post('/api/rooms/:id/voice', async (request, reply) => {
      const me = currentUser(request);
      const { id } = idParam.parse(request.params);
      if (!(await membership(id, me.id))) return notMember(reply);
      if (!env.voiceEnabled) return reply.code(503).send({ error: 'voice_disabled' });
      return voiceToken(id, me);
    });

    auth.get('/api/rooms/:id/leaderboard', async (request, reply) => {
      const me = currentUser(request);
      const { id } = idParam.parse(request.params);
      if (!(await membership(id, me.id))) return notMember(reply);
      const { period } = z.object({ period: z.enum(['week', 'month', 'all']).default('week') }).parse(request.query) as {
        period: LeaderboardPeriod;
      };
      return { period, rows: await leaderboard(me.id, await memberIds(id), period) };
    });

    // ---------- Chat ----------

    auth.get('/api/rooms/:id/messages', async (request, reply) => {
      const { id } = idParam.parse(request.params);
      if (!(await membership(id, currentUser(request).id))) return notMember(reply);
      const { before } = z.object({ before: z.string().datetime().optional() }).parse(request.query);
      return { messages: await listMessages(id, before ? new Date(before) : undefined) };
    });

    auth.post('/api/rooms/:id/messages', async (request, reply) => {
      const me = currentUser(request);
      const { id } = idParam.parse(request.params);
      if (!(await membership(id, me.id))) return notMember(reply);
      const body = z
        .object({
          body: z.string().trim().min(1).max(ROOM_RULES.messageMax),
          replyToId: z.string().uuid().nullable().default(null)
        })
        .parse(request.body);
      if (!allow(`msg:${me.id}`, ROOM_RULES.messagesPerMinute)) return reply.code(429).send({ error: 'slow_down' });
      return { message: await postMessage({ roomId: id, userId: me.id, kind: 'text', ...body }) };
    });

    auth.post('/api/rooms/:id/images', async (request, reply) => {
      const me = currentUser(request);
      const { id } = idParam.parse(request.params);
      if (!(await membership(id, me.id))) return notMember(reply);
      if (!allow(`img:${me.id}`, ROOM_RULES.imagesPerMinute)) return reply.code(429).send({ error: 'slow_down' });
      const file = await request.file();
      if (!file) return reply.code(400).send({ error: 'no_file' });
      const buffer = await file.toBuffer().catch(() => null);
      if (!buffer || file.file.truncated) return reply.code(413).send({ error: 'too_large' });
      const caption = typeof (file.fields.caption as { value?: unknown } | undefined)?.value === 'string'
        ? String((file.fields.caption as { value: string }).value).slice(0, ROOM_RULES.messageMax)
        : '';
      try {
        const img = await storeImage(id, me.id, buffer);
        return { message: await postMessage({ roomId: id, userId: me.id, kind: 'image', body: caption, imageId: img.id }) };
      } catch (err) {
        if (err instanceof BadImage) return reply.code(415).send({ error: 'not_an_image' });
        throw err;
      }
    });

    auth.patch('/api/messages/:id', async (request, reply) => {
      const me = currentUser(request);
      const { id } = idParam.parse(request.params);
      const { body } = z.object({ body: z.string().trim().min(1).max(ROOM_RULES.messageMax) }).parse(request.body);
      const cutoff = new Date(Date.now() - ROOM_RULES.editWindowSeconds * 1000);
      const updated = await db
        .update(m)
        .set({ body, editedAt: new Date() })
        .where(and(eq(m.id, id), eq(m.userId, me.id), isNull(m.deletedAt), sql`${m.createdAt} > ${cutoff}`))
        .returning({ roomId: m.roomId });
      if (!updated.length) return reply.code(403).send({ error: 'cannot_edit' });
      const msg = await getMessage(id);
      emitRoom(updated[0]!.roomId, 'chat:update', msg);
      return { message: msg };
    });

    auth.delete('/api/messages/:id', async (request, reply) => {
      const me = currentUser(request);
      const { id } = idParam.parse(request.params);
      const [msg] = await db.select().from(m).where(eq(m.id, id)).limit(1);
      if (!msg) return reply.code(404).send({ error: 'not_found' });
      const mem = await membership(msg.roomId, me.id);
      if (!mem || (msg.userId !== me.id && mem.role !== 'owner')) return reply.code(403).send({ error: 'forbidden' });
      await db.update(m).set({ deletedAt: new Date() }).where(eq(m.id, id));
      emitRoom(msg.roomId, 'chat:update', await getMessage(id));
      return { ok: true };
    });

    auth.post('/api/messages/:id/report', async (request, reply) => {
      const me = currentUser(request);
      const { id } = idParam.parse(request.params);
      const { reason } = z.object({ reason: z.string().trim().max(500).default('') }).parse(request.body ?? {});
      const [msg] = await db.select({ roomId: m.roomId }).from(m).where(eq(m.id, id)).limit(1);
      if (!msg || !(await membership(msg.roomId, me.id))) return reply.code(404).send({ error: 'not_found' });
      if (!allow(`report:${me.id}`, 10)) return reply.code(429).send({ error: 'slow_down' });
      await db.insert(schema.reports).values({ reporterId: me.id, messageId: id, reason });
      return { ok: true };
    });

    // ---------- Admin: reports ----------

    auth.get('/api/admin/reports', async (request, reply) => {
      if (!isAdminUser(currentUser(request))) return reply.code(403).send({ error: 'forbidden' });
      const rows = await db
        .select({ id: schema.reports.id, reason: schema.reports.reason, createdAt: schema.reports.createdAt, messageId: schema.reports.messageId })
        .from(schema.reports)
        .where(isNull(schema.reports.resolvedAt))
        .orderBy(schema.reports.createdAt)
        .limit(100);
      const out = [];
      for (const r of rows) out.push({ ...r, message: await getMessage(r.messageId) });
      return { reports: out };
    });

    auth.post('/api/admin/reports/:id/resolve', async (request, reply) => {
      if (!isAdminUser(currentUser(request))) return reply.code(403).send({ error: 'forbidden' });
      const { id } = idParam.parse(request.params);
      const { deleteMessage } = z.object({ deleteMessage: z.boolean().default(false) }).parse(request.body ?? {});
      const [report] = await db.update(schema.reports).set({ resolvedAt: new Date() }).where(eq(schema.reports.id, id)).returning();
      if (report && deleteMessage) {
        const [msg] = await db.update(m).set({ deletedAt: new Date() }).where(eq(m.id, report.messageId)).returning();
        if (msg) emitRoom(msg.roomId, 'chat:update', await getMessage(msg.id));
      }
      return { ok: true };
    });
  });
}
