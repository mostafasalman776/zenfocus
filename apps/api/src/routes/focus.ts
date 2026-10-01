import { FOCUS_RULES } from '@zenfocus/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser, requireUser } from '../auth/session.js';
import * as focus from '../focus/service.js';
import { announceFocus } from '../realtime/socket.js';

type Row = Parameters<typeof focus.serialize>[0];

const payload = (r: { open: Row | null; ended: Row | null }) => ({
  session: r.open ? focus.serialize(r.open) : null,
  ended: r.ended ? focus.serialize(r.ended) : null
});

/** Keep room presence in sync with the session the user now has. */
function sync(user: { id: string; name: string }, r: { open: Row | null; ended: Row | null }) {
  const state = r.open ? (r.open.status === 'running' ? 'focus' : 'paused') : null;
  announceFocus(user.id, user.name, state);
  return payload(r);
}

export async function focusRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  // Also the "I'm back" check the client runs when the tab becomes visible.
  app.get('/api/focus/active', async (request) => {
    const user = currentUser(request);
    return sync(user, await focus.touch(user.id));
  });

  app.post('/api/focus/start', async (request) => {
    const body = z
      .object({
        plannedSeconds: z
          .number()
          .int()
          .min(FOCUS_RULES.minPlannedSeconds)
          .max(FOCUS_RULES.maxPlannedSeconds),
        taskId: z.string().uuid().nullable().default(null)
      })
      .parse(request.body);
    const user = currentUser(request);
    const row = await focus.start(user.id, body.plannedSeconds, body.taskId);
    announceFocus(user.id, user.name, 'focus', Math.round(body.plannedSeconds / 60));
    return { session: focus.serialize(row), ended: null };
  });

  app.post('/api/focus/heartbeat', async (request) => {
    const user = currentUser(request);
    return sync(user, await focus.heartbeat(user.id));
  });
  app.post('/api/focus/pause', async (request) => {
    const user = currentUser(request);
    return sync(user, await focus.pause(user.id));
  });
  app.post('/api/focus/resume', async (request) => {
    const user = currentUser(request);
    return sync(user, await focus.resume(user.id));
  });

  app.post('/api/focus/end', async (request) => {
    const { reason } = z.object({ reason: z.enum(['completed', 'stopped']) }).parse(request.body);
    const user = currentUser(request);
    const ended = await focus.end(user.id, reason);
    announceFocus(user.id, user.name, null);
    return { session: null, ended: ended ? focus.serialize(ended) : null };
  });
}
