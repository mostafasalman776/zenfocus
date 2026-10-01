import type { PresenceStatus } from '@zenfocus/shared';
import type { Server } from 'socket.io';

// In-process realtime state. One API process (PM2 fork mode) keeps this simple;
// moving to several processes would need the Socket.io Redis adapter.

let io: Server | null = null;

/** roomId → userId → number of that user's sockets in the room. */
const present = new Map<string, Map<string, number>>();
/** userId → the room they are currently in (one at a time). */
const currentRoom = new Map<string, string>();
/** userId → focus state, kept in sync by the focus routes. */
const focusState = new Map<string, 'focus' | 'paused'>();

export function setIo(server: Server) {
  io = server;
}

export function emitRoom(roomId: string, event: string, payload: unknown) {
  io?.to(`room:${roomId}`).emit(event, payload);
}

export function emitUser(userId: string, event: string, payload: unknown) {
  io?.to(`user:${userId}`).emit(event, payload);
}

export function statusOf(roomId: string, userId: string): PresenceStatus {
  if (!present.get(roomId)?.get(userId)) return 'offline';
  return focusState.get(userId) ?? 'online';
}

export function roomOf(userId: string): string | undefined {
  return currentRoom.get(userId);
}

export function enter(roomId: string, userId: string) {
  const users = present.get(roomId) ?? new Map<string, number>();
  users.set(userId, (users.get(userId) ?? 0) + 1);
  present.set(roomId, users);
  currentRoom.set(userId, roomId);
  emitRoom(roomId, 'room:status', { userId, status: statusOf(roomId, userId) });
}

export function leave(roomId: string, userId: string) {
  const users = present.get(roomId);
  if (!users) return;
  const n = (users.get(userId) ?? 1) - 1;
  if (n > 0) users.set(userId, n);
  else {
    users.delete(userId);
    if (currentRoom.get(userId) === roomId) currentRoom.delete(userId);
  }
  if (!users.size) present.delete(roomId);
  emitRoom(roomId, 'room:status', { userId, status: statusOf(roomId, userId) });
}

/** Called whenever a user's focus session starts, pauses, resumes or ends. */
export function setFocusState(userId: string, state: 'focus' | 'paused' | null) {
  if (state) focusState.set(userId, state);
  else focusState.delete(userId);
  const roomId = currentRoom.get(userId);
  if (roomId) emitRoom(roomId, 'room:status', { userId, status: statusOf(roomId, userId) });
}

/** Kick every socket of a user out of a room (removed member or deleted room). */
export async function evict(roomId: string, userId: string | null) {
  if (!io) return;
  const sockets = await io.in(`room:${roomId}`).fetchSockets();
  for (const s of sockets) {
    if (userId && s.data.userId !== userId) continue;
    s.leave(`room:${roomId}`);
    s.emit('room:removed', { roomId });
    s.data.roomId = undefined;
    leave(roomId, s.data.userId as string);
  }
}
