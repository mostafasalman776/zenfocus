import { FOCUS_RULES } from '@zenfocus/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser, requireUser } from '../auth/session.js';
import * as focus from '../focus/service.js';

type Row = Parameters<typeof focus.serialize>[0];

const payload = (r: { open: Row | null; ended: Row | null }) => ({
  session: r.open ? focus.serialize(r.open) : null,
  ended: r.ended ? focus.serialize(r.ended) : null
});

export async function focusRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  // Also the "I'm back" check the client runs when the tab becomes visible.
  app.get('/api/focus/active', async (request) => payload(await focus.touch(currentUser(request).id)));

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
    const row = await focus.start(currentUser(request).id, body.plannedSeconds, body.taskId);
    return { session: focus.serialize(row), ended: null };
  });

  app.post('/api/focus/heartbeat', async (request) => payload(await focus.heartbeat(currentUser(request).id)));
  app.post('/api/focus/pause', async (request) => payload(await focus.pause(currentUser(request).id)));
  app.post('/api/focus/resume', async (request) => payload(await focus.resume(currentUser(request).id)));

  app.post('/api/focus/end', async (request) => {
    const { reason } = z.object({ reason: z.enum(['completed', 'stopped']) }).parse(request.body);
    const ended = await focus.end(currentUser(request).id, reason);
    return { session: null, ended: ended ? focus.serialize(ended) : null };
  });
}
