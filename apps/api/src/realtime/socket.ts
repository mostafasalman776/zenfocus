import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { z } from 'zod';
import { SESSION_COOKIE, userFromToken } from '../auth/session.js';
import { env } from '../env.js';
import * as focus from '../focus/service.js';
import { allow, membership } from '../rooms/service.js';
import { emitRoom, enter, leave, roomOf, setFocusState, setIo } from './hub.js';

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

type Ack = (res: unknown) => void;

export function attachRealtime(app: FastifyInstance) {
  const io = new Server(app.server, {
    path: '/api/socket.io',
    cors: { origin: env.APP_ORIGIN, credentials: true },
    maxHttpBufferSize: 64 * 1024 // images go over HTTP, not the socket
  });
  setIo(io);

  io.use(async (socket, next) => {
    const user = await userFromToken(cookieValue(socket.handshake.headers.cookie, SESSION_COOKIE));
    if (!user) return next(new Error('unauthorized'));
    socket.data.userId = user.id;
    socket.data.name = user.name;
    next();
  });

  io.on('connection', async (socket) => {
    const userId = socket.data.userId as string;
    void socket.join(`user:${userId}`);

    // Seed presence with any session already open (e.g. started on another device).
    const open = await focus.getOpen(userId).catch(() => null);
    if (open) setFocusState(userId, open.status === 'running' ? 'focus' : 'paused');

    const leaveCurrent = () => {
      const roomId = socket.data.roomId as string | undefined;
      if (!roomId) return;
      void socket.leave(`room:${roomId}`);
      socket.data.roomId = undefined;
      leave(roomId, userId);
    };

    socket.on('room:join', async (raw: unknown, ack?: Ack) => {
      const parsed = z.object({ roomId: z.string().uuid() }).safeParse(raw);
      if (!parsed.success) return ack?.({ error: 'invalid_input' });
      const { roomId } = parsed.data;
      if (socket.data.roomId === roomId) return ack?.({ ok: true });
      if (!(await membership(roomId, userId))) return ack?.({ error: 'room_not_found' });
      leaveCurrent();
      await socket.join(`room:${roomId}`);
      socket.data.roomId = roomId;
      enter(roomId, userId);
      ack?.({ ok: true });
    });

    socket.on('room:leave', () => leaveCurrent());

    socket.on('room:cheer', (raw: unknown) => {
      const roomId = socket.data.roomId as string | undefined;
      const parsed = z.object({ kind: z.enum(['star', 'heart', 'flame']) }).safeParse(raw);
      if (!roomId || !parsed.success) return;
      if (!allow(`cheer:${userId}`, 12)) return;
      emitRoom(roomId, 'room:cheer', { userId, name: socket.data.name, kind: parsed.data.kind, at: Date.now() });
    });

    socket.on('chat:typing', () => {
      const roomId = socket.data.roomId as string | undefined;
      if (roomId) socket.to(`room:${roomId}`).emit('chat:typing', { userId, name: socket.data.name });
    });

    socket.on('focus:heartbeat', async (ack?: Ack) => {
      try {
        const r = await focus.heartbeat(userId);
        if (r.ended) setFocusState(userId, null);
        ack?.({
          session: r.open ? focus.serialize(r.open) : null,
          ended: r.ended ? focus.serialize(r.ended) : null
        });
      } catch (err) {
        app.log.error({ err }, 'heartbeat failed');
        ack?.({ error: 'server_error' });
      }
    });

    socket.on('disconnect', () => leaveCurrent());
  });

  return io;
}

/** Tell the user's room their focus state changed, with a short notice on start. */
export function announceFocus(userId: string, name: string, state: 'focus' | 'paused' | null, startedMinutes?: number) {
  setFocusState(userId, state);
  if (startedMinutes) {
    const roomId = roomOf(userId);
    if (roomId) emitRoom(roomId, 'room:event', { text: `بدأ ${name} جلسة تركيز (${startedMinutes} دقيقة)` });
  }
}
