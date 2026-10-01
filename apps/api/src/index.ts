import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { SESSION_COOKIE, userFromToken } from './auth/session.js';
import { closeDb, runMigrations } from './db/index.js';
import { env } from './env.js';
import { SWEEP_INTERVAL_MS, sweep } from './focus/service.js';
import { attachRealtime } from './realtime/socket.js';
import { authRoutes } from './routes/auth.js';
import { focusRoutes } from './routes/focus.js';
import { friendRoutes } from './routes/friends.js';
import { importRoutes } from './routes/import.js';
import { meRoutes } from './routes/me.js';
import { taskRoutes } from './routes/tasks.js';

const app = Fastify({
  logger: { level: env.isProd ? 'info' : 'debug' },
  // Behind Nginx in production.
  trustProxy: env.isProd ? '127.0.0.1' : false,
  bodyLimit: 1024 * 1024
});

await app.register(cookie);
await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

app.decorateRequest('user', null);
app.addHook('onRequest', async (request) => {
  request.user = await userFromToken(request.cookies[SESSION_COOKIE]);
});

app.setErrorHandler((err, request, reply) => {
  if (err instanceof ZodError) return reply.code(400).send({ error: 'invalid_input', issues: err.issues });
  const e = err as { statusCode?: number; message?: string };
  const status = e.statusCode ?? 500;
  if (status >= 500) request.log.error({ err }, 'request failed');
  return reply.code(status).send({ error: status >= 500 ? 'server_error' : e.message });
});

app.get('/api/health', async () => ({ ok: true }));
await app.register(authRoutes);
await app.register(meRoutes);
await app.register(taskRoutes);
await app.register(focusRoutes);
await app.register(friendRoutes);
await app.register(importRoutes);

await runMigrations();
attachRealtime(app);

const sweeper = setInterval(() => {
  sweep()
    .then((n) => n && app.log.info({ closed: n }, 'swept focus sessions'))
    .catch((err) => app.log.error({ err }, 'sweep failed'));
}, SWEEP_INTERVAL_MS);

async function shutdown() {
  clearInterval(sweeper);
  await app.close();
  await closeDb();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: env.HOST, port: env.PORT });
