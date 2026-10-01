import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { SESSION_COOKIE, userFromToken } from '../auth/session.js';
import { env } from '../env.js';
import * as focus from '../focus/service.js';

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export function attachRealtime(app: FastifyInstance) {
  const io = new Server(app.server, {
    path: '/api/socket.io',
    cors: { origin: env.APP_ORIGIN, credentials: true }
  });

  io.use(async (socket, next) => {
    const user = await userFromToken(cookieValue(socket.handshake.headers.cookie, SESSION_COOKIE));
    if (!user) return next(new Error('unauthorized'));
    socket.data.userId = user.id;
    next();
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId as string;
    void socket.join(`user:${userId}`);

    socket.on('focus:heartbeat', async (ack?: (res: unknown) => void) => {
      try {
        const r = await focus.heartbeat(userId);
        ack?.({
          session: r.open ? focus.serialize(r.open) : null,
          ended: r.ended ? focus.serialize(r.ended) : null
        });
      } catch (err) {
        app.log.error({ err }, 'heartbeat failed');
        ack?.({ error: 'server_error' });
      }
    });
  });

  return io;
}
