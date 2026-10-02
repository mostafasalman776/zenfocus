import type { FastifyInstance } from 'fastify';
import { currentUser, newInviteCode, requireUser } from '../auth/session.js';
import { db, schema } from '../db/index.js';
import { env } from '../env.js';
import { makeFriends } from '../lib/friends.js';

/**
 * Development only: fill the signed-in account with realistic history and a few
 * friends, so the stats and leaderboard can be designed against real-looking data.
 */
export async function devRoutes(app: FastifyInstance) {
  if (!env.devLogin) return;

  app.post('/api/dev/seed', { preHandler: requireUser }, async (request) => {
    const me = currentUser(request);
    const tags = ['فيزياء', 'كيمياء', 'رياضيات', 'لغة إنجليزية'];
    let seed = 11;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);

    async function history(userId: string, days: number, intensity: number) {
      const rows: (typeof schema.focusSessions.$inferInsert)[] = [];
      for (let d = days; d >= 0; d--) {
        if (rnd() < 0.25) continue;
        const sessions = Math.floor(rnd() * 5 * intensity) + 1;
        for (let s = 0; s < sessions; s++) {
          const start = new Date(Date.now() - d * 86400_000 - (s + 1) * 40 * 60_000);
          const seconds = 25 * 60;
          rows.push({
            userId,
            tag: tags[Math.floor(rnd() * tags.length)]!,
            plannedSeconds: seconds,
            status: 'ended',
            startedAt: start,
            lastHeartbeatAt: start,
            endedAt: new Date(start.getTime() + seconds * 1000),
            endReason: 'completed',
            accumulatedSeconds: seconds,
            creditedSeconds: seconds,
            completed: true
          });
        }
      }
      for (let i = 0; i < rows.length; i += 200) await db.insert(schema.focusSessions).values(rows.slice(i, i + 200));
      return rows.length;
    }

    const mine = await history(me.id, 150, 1);
    const friends = [
      ['سارة أحمد', 1.3],
      ['عمر خالد', 1.1],
      ['نور محمد', 0.8],
      ['ليلى حسن', 0.6],
      ['كريم علي', 0.4]
    ] as const;
    for (const [name, intensity] of friends) {
      const [u] = await db
        .insert(schema.users)
        .values({ name, username: `dev_${Math.floor(rnd() * 1e6)}`, inviteCode: newInviteCode(), googleSub: `seed:${name}:${Date.now()}` })
        .returning();
      await makeFriends(me.id, u!.id);
      await history(u!.id, 30, intensity);
    }
    return { sessions: mine, friends: friends.length };
  });
}
