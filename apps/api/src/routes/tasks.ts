import { LIMITS, type Task } from '@zenfocus/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser, requireUser } from '../auth/session.js';
import { db, schema } from '../db/index.js';

const t = schema.tasks;

export const toTask = (r: typeof t.$inferSelect): Task => ({
  id: r.id,
  title: r.title,
  done: r.done,
  estPomodoros: r.estPomodoros,
  donePomodoros: r.donePomodoros,
  tag: r.tag,
  position: r.position
});

const fields = {
  title: z.string().trim().min(1).max(LIMITS.taskTitleMax),
  done: z.boolean(),
  estPomodoros: z.number().int().min(1).max(20),
  tag: z.string().trim().max(30).nullable(),
  position: z.number().int().min(0)
};

export async function taskRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.get('/api/tasks', async (request) => {
    const user = currentUser(request);
    const rows = await db
      .select()
      .from(t)
      .where(eq(t.userId, user.id))
      .orderBy(asc(t.done), asc(t.position), asc(t.createdAt));
    return { tasks: rows.map(toTask) };
  });

  app.post('/api/tasks', async (request, reply) => {
    const user = currentUser(request);
    const body = z
      .object({ title: fields.title, estPomodoros: fields.estPomodoros.default(1), tag: fields.tag.default(null) })
      .parse(request.body);
    const [count] = await db
      .select({ n: sql<number>`count(*)::int`, max: sql<number>`coalesce(max(${t.position}), -1)::int` })
      .from(t)
      .where(eq(t.userId, user.id));
    if ((count?.n ?? 0) >= LIMITS.maxTasks) return reply.code(422).send({ error: 'too_many_tasks' });
    const [row] = await db
      .insert(t)
      .values({ ...body, userId: user.id, position: (count?.max ?? -1) + 1 })
      .returning();
    return { task: toTask(row!) };
  });

  app.patch('/api/tasks/:id', async (request, reply) => {
    const user = currentUser(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object(fields).partial().parse(request.body);
    const [row] = await db
      .update(t)
      .set({ ...body, ...(body.done === undefined ? {} : { doneAt: body.done ? new Date() : null }) })
      .where(and(eq(t.id, id), eq(t.userId, user.id)))
      .returning();
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return { task: toTask(row) };
  });

  app.delete('/api/tasks/:id', async (request) => {
    const user = currentUser(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await db.delete(t).where(and(eq(t.id, id), eq(t.userId, user.id)));
    return { ok: true };
  });
}
