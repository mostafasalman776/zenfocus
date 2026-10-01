import {
  addDays,
  cairoDay,
  streakFrom,
  type LeaderboardPeriod,
  type LeaderboardRow
} from '@zenfocus/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema, tzSql } from '../db/index.js';

const fs = schema.focusSessions;
const dayExpr = sql<string>`to_char((${fs.startedAt} at time zone ${tzSql})::date, 'YYYY-MM-DD')`;

/** First Cairo day of the period, or null for all time. Weeks start on Saturday. */
export function periodStart(period: LeaderboardPeriod, today = cairoDay(new Date())): string | null {
  if (period === 'all') return null;
  if (period === 'month') return `${today.slice(0, 8)}01`;
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday, 6 = Saturday
  return addDays(today, -((dow + 1) % 7));
}

/** Seconds per Cairo day for each user since `fromDay`. */
export async function dailyTotals(
  userIds: string[],
  fromDay: string | null,
  opts: { includeImported: boolean }
): Promise<Map<string, Record<string, number>>> {
  const out = new Map<string, Record<string, number>>();
  if (!userIds.length) return out;
  const conds = [inArray(fs.userId, userIds), sql`${fs.creditedSeconds} > 0`];
  if (!opts.includeImported) conds.push(eq(fs.imported, false));
  if (fromDay) conds.push(sql`(${fs.startedAt} at time zone ${tzSql})::date >= ${fromDay}::date`);
  const rows = await db
    .select({
      userId: fs.userId,
      day: dayExpr,
      seconds: sql<number>`sum(${fs.creditedSeconds})::int`
    })
    .from(fs)
    .where(and(...conds))
    .groupBy(fs.userId, dayExpr);
  for (const r of rows) {
    const days = out.get(r.userId) ?? {};
    days[r.day] = r.seconds;
    out.set(r.userId, days);
  }
  return out;
}

export async function leaderboard(
  meId: string,
  userIds: string[],
  period: LeaderboardPeriod
): Promise<LeaderboardRow[]> {
  const today = cairoDay(new Date());
  const from = periodStart(period, today);
  const conds = [inArray(fs.userId, userIds), eq(fs.imported, false)];
  if (from) conds.push(sql`(${fs.startedAt} at time zone ${tzSql})::date >= ${from}::date`);

  const [totals, users, streakDays] = await Promise.all([
    db
      .select({
        userId: fs.userId,
        seconds: sql<number>`coalesce(sum(${fs.creditedSeconds}), 0)::int`,
        sessions: sql<number>`(count(*) filter (where ${fs.completed}))::int`
      })
      .from(fs)
      .where(and(...conds))
      .groupBy(fs.userId),
    db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        username: schema.users.username,
        avatarUrl: schema.users.avatarUrl
      })
      .from(schema.users)
      .where(inArray(schema.users.id, userIds)),
    dailyTotals(userIds, addDays(today, -400), { includeImported: false })
  ]);

  const byUser = new Map(totals.map((t) => [t.userId, t]));
  return users
    .map((u) => ({
      userId: u.id,
      name: u.name,
      username: u.username,
      avatarUrl: u.avatarUrl,
      seconds: byUser.get(u.id)?.seconds ?? 0,
      sessions: byUser.get(u.id)?.sessions ?? 0,
      streak: streakFrom(streakDays.get(u.id) ?? {}, today),
      isMe: u.id === meId
    }))
    .sort((a, b) => b.seconds - a.seconds || b.sessions - a.sessions || a.name.localeCompare(b.name));
}
