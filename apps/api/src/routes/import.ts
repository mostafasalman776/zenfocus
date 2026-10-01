import { FOCUS_RULES, LIMITS } from '@zenfocus/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser, requireUser } from '../auth/session.js';
import { db, schema } from '../db/index.js';

const YEAR_MS = 365 * 86400_000;

/**
 * Move guest data (localStorage) into the new account. Imported sessions are
 * unverified, so they are flagged and never count on leaderboards.
 */
export async function importRoutes(app: FastifyInstance) {
  app.post(
    '/api/import/guest',
    { preHandler: requireUser, config: { rateLimit: { max: 3, timeWindow: '1 hour' } } },
    async (request) => {
      const user = currentUser(request);
      const body = z
        .object({
          tasks: z
            .array(
              z.object({
                title: z.string().trim().min(1).max(LIMITS.taskTitleMax),
                done: z.boolean(),
                estPomodoros: z.number().int().min(1).max(20),
                donePomodoros: z.number().int().min(0).max(100)
              })
            )
            .max(LIMITS.maxTasks),
          sessions: z
            .array(
              z.object({
                startedAt: z.string().datetime(),
                seconds: z.number().int().min(0).max(FOCUS_RULES.maxPlannedSeconds),
                completed: z.boolean()
              })
            )
            .max(LIMITS.guestImportMaxSessions)
        })
        .parse(request.body);

      const now = Date.now();
      if (body.tasks.length) {
        await db.insert(schema.tasks).values(
          body.tasks.map((t, i) => ({ ...t, userId: user.id, position: 1000 + i, doneAt: t.done ? new Date() : null }))
        );
      }
      const sessions = body.sessions
        .map((s) => ({ ...s, at: new Date(s.startedAt) }))
        .filter((s) => s.at.getTime() <= now && now - s.at.getTime() <= YEAR_MS && s.seconds > 0);
      if (sessions.length) {
        await db.insert(schema.focusSessions).values(
          sessions.map((s) => ({
            userId: user.id,
            plannedSeconds: s.seconds,
            status: 'ended' as const,
            startedAt: s.at,
            lastHeartbeatAt: s.at,
            endedAt: new Date(s.at.getTime() + s.seconds * 1000),
            endReason: 'imported',
            accumulatedSeconds: s.seconds,
            creditedSeconds: s.seconds,
            completed: s.completed,
            imported: true
          }))
        );
      }
      return { tasks: body.tasks.length, sessions: sessions.length };
    }
  );
}
