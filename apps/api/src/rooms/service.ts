import {
  ROOM_RULES,
  addDays,
  cairoDay,
  type ChatMessage,
  type RoomDetail,
  type RoomRole,
  type RoomTimer
} from '@zenfocus/shared';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, schema } from '../db/index.js';
import { dailyTotals } from '../lib/aggregates.js';
import { emitRoom, statusOf } from '../realtime/hub.js';
import { chatImage } from './images.js';

const { rooms, roomMembers: rm, messages: m, users: u, images } = schema;

export type RoomRow = typeof rooms.$inferSelect;

export async function membership(roomId: string, userId: string): Promise<{ room: RoomRow; role: RoomRole } | null> {
  const rows = await db
    .select({ room: rooms, role: rm.role })
    .from(rm)
    .innerJoin(rooms, eq(rooms.id, rm.roomId))
    .where(and(eq(rm.roomId, roomId), eq(rm.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function memberIds(roomId: string): Promise<string[]> {
  const rows = await db.select({ id: rm.userId }).from(rm).where(eq(rm.roomId, roomId));
  return rows.map((r) => r.id);
}

export function timerOf(room: RoomRow): RoomTimer {
  return {
    focusMinutes: room.focusMinutes,
    breakMinutes: room.breakMinutes,
    running: room.timerRunning,
    startedAt: room.timerStartedAt?.toISOString() ?? null,
    elapsedSeconds: room.timerElapsedSeconds
  };
}

export async function roomDetail(room: RoomRow, role: RoomRole): Promise<RoomDetail> {
  const members = await db
    .select({ userId: u.id, name: u.name, username: u.username, avatarUrl: u.avatarUrl, role: rm.role, joinedAt: rm.joinedAt })
    .from(rm)
    .innerJoin(u, eq(u.id, rm.userId))
    .where(eq(rm.roomId, room.id))
    .orderBy(rm.joinedAt);
  const today = cairoDay(new Date());
  const totals = await dailyTotals(
    members.map((x) => x.userId),
    addDays(today, -1),
    { includeImported: false }
  );
  return {
    id: room.id,
    name: room.name,
    role,
    ownerId: room.ownerId,
    inviteCode: room.inviteCode,
    memberCount: members.length,
    timer: timerOf(room),
    members: members.map((x) => ({
      userId: x.userId,
      name: x.name,
      username: x.username,
      avatarUrl: x.avatarUrl,
      role: x.role,
      status: statusOf(room.id, x.userId),
      todaySeconds: totals.get(x.userId)?.[today] ?? 0
    }))
  };
}

// ---------- Messages ----------

const replyMsg = alias(m, 'reply_msg');
const replyUser = alias(u, 'reply_user');

const messageSelect = {
  msg: m,
  user: { id: u.id, name: u.name, avatarUrl: u.avatarUrl },
  image: images,
  reply: { id: replyMsg.id, body: replyMsg.body, kind: replyMsg.kind, deletedAt: replyMsg.deletedAt },
  replyUserName: replyUser.name
};

type MessageRow = {
  msg: typeof m.$inferSelect;
  user: { id: string; name: string; avatarUrl: string | null } | null;
  image: typeof images.$inferSelect | null;
  reply: { id: string; body: string; kind: string; deletedAt: Date | null } | null;
  replyUserName: string | null;
};

function toMessage(r: MessageRow): ChatMessage {
  const deleted = Boolean(r.msg.deletedAt);
  const replyBody = r.reply
    ? r.reply.deletedAt
      ? 'رسالة اتمسحت'
      : r.reply.kind === 'image'
        ? 'صورة'
        : r.reply.body.slice(0, 120)
    : null;
  return {
    id: r.msg.id,
    roomId: r.msg.roomId,
    kind: r.msg.kind,
    body: deleted ? '' : r.msg.body,
    user: r.user?.id ? r.user : null,
    replyTo: r.reply?.id ? { id: r.reply.id, body: replyBody!, userName: r.replyUserName } : null,
    image: !deleted && r.image?.id ? chatImage(r.image) : null,
    createdAt: r.msg.createdAt.toISOString(),
    editedAt: r.msg.editedAt?.toISOString() ?? null,
    deleted
  };
}

function baseQuery() {
  return db
    .select(messageSelect)
    .from(m)
    .leftJoin(u, eq(u.id, m.userId))
    .leftJoin(images, eq(images.id, m.imageId))
    .leftJoin(replyMsg, eq(replyMsg.id, m.replyToId))
    .leftJoin(replyUser, eq(replyUser.id, replyMsg.userId));
}

/** Newest page first from the DB, returned oldest → newest for display. */
export async function listMessages(roomId: string, before?: Date): Promise<ChatMessage[]> {
  const where = before ? and(eq(m.roomId, roomId), lt(m.createdAt, before)) : eq(m.roomId, roomId);
  const rows = await baseQuery().where(where).orderBy(desc(m.createdAt)).limit(ROOM_RULES.pageSize);
  return (rows as MessageRow[]).map(toMessage).reverse();
}

export async function getMessage(id: string): Promise<ChatMessage | null> {
  const rows = await baseQuery().where(eq(m.id, id)).limit(1);
  return rows[0] ? toMessage(rows[0] as MessageRow) : null;
}

export async function postMessage(input: {
  roomId: string;
  userId: string | null;
  kind: 'text' | 'image' | 'system';
  body?: string;
  replyToId?: string | null;
  imageId?: string | null;
}): Promise<ChatMessage> {
  let replyToId = input.replyToId ?? null;
  if (replyToId) {
    // Replies only to messages in the same room.
    const [target] = await db
      .select({ id: m.id })
      .from(m)
      .where(and(eq(m.id, replyToId), eq(m.roomId, input.roomId)))
      .limit(1);
    if (!target) replyToId = null;
  }
  const [row] = await db
    .insert(m)
    .values({
      roomId: input.roomId,
      userId: input.userId,
      kind: input.kind,
      body: input.body ?? '',
      replyToId,
      imageId: input.imageId ?? null
    })
    .returning({ id: m.id });
  const msg = (await getMessage(row!.id))!;
  emitRoom(input.roomId, 'chat:message', msg);
  return msg;
}

export async function systemMessage(roomId: string, body: string) {
  return postMessage({ roomId, userId: null, kind: 'system', body });
}

// ---------- Simple in-memory rate limiting (one process) ----------

const buckets = new Map<string, number[]>();

export function allow(key: string, perMinute: number): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= perMinute) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, hits] of buckets) if (!hits.some((t) => now - t < 60_000)) buckets.delete(k);
}, 5 * 60_000).unref();

export async function roomsOf(userId: string) {
  const mine = await db
    .select({ id: rooms.id, name: rooms.name, role: rm.role, inviteCode: rooms.inviteCode })
    .from(rm)
    .innerJoin(rooms, eq(rooms.id, rm.roomId))
    .where(eq(rm.userId, userId))
    .orderBy(rm.joinedAt);
  if (!mine.length) return [];
  const counts = await db
    .select({ roomId: rm.roomId, n: sql<number>`count(*)::int` })
    .from(rm)
    .where(inArray(rm.roomId, mine.map((r) => r.id)))
    .groupBy(rm.roomId);
  const byRoom = new Map(counts.map((c) => [c.roomId, c.n]));
  return mine.map((r) => ({ ...r, memberCount: byRoom.get(r.id) ?? 1 }));
}
