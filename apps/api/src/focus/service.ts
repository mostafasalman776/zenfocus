import { cairoDay, type FocusSession } from '@zenfocus/shared';
import { and, eq, ne, sql } from 'drizzle-orm';
import { db, schema, tzSql } from '../db/index.js';
import {
  activeSeconds,
  applyDailyCap,
  creditOnEnd,
  plannedEnd,
  sweepReason,
  type EndReason,
  type SessionClock
} from './rules.js';

type Row = typeof schema.focusSessions.$inferSelect;

function clock(row: Row): SessionClock {
  return {
    plannedSeconds: row.plannedSeconds,
    accumulatedSeconds: row.accumulatedSeconds,
    segmentStartedAt: row.segmentStartedAt?.getTime() ?? null,
    lastHeartbeatAt: row.lastHeartbeatAt.getTime(),
    pausedAt: row.pausedAt?.getTime() ?? null
  };
}

export function serialize(row: Row, now = Date.now()): FocusSession {
  const c = clock(row);
  const end = row.status === 'running' ? plannedEnd(c) : null;
  return {
    id: row.id,
    taskId: row.taskId,
    plannedSeconds: row.plannedSeconds,
    status: row.status,
    activeSeconds: row.status === 'ended' ? row.creditedSeconds : activeSeconds(c, now),
    plannedEndAt: end ? new Date(end).toISOString() : null,
    creditedSeconds: row.creditedSeconds,
    completed: row.completed
  };
}

export async function getOpen(userId: string): Promise<Row | null> {
  const rows = await db
    .select()
    .from(schema.focusSessions)
    .where(and(eq(schema.focusSessions.userId, userId), ne(schema.focusSessions.status, 'ended')))
    .limit(1);
  return rows[0] ?? null;
}

/** Seconds already credited on the Cairo day this session started, excluding it. */
async function creditedThatDay(row: Row): Promise<number> {
  const day = cairoDay(row.startedAt);
  const [res] = await db
    .select({
      total: sql<number>`coalesce(sum(${schema.focusSessions.creditedSeconds}), 0)::int`
    })
    .from(schema.focusSessions)
    .where(
      and(
        eq(schema.focusSessions.userId, row.userId),
        eq(schema.focusSessions.imported, false),
        ne(schema.focusSessions.id, row.id),
        sql`(${schema.focusSessions.startedAt} at time zone ${tzSql})::date = ${day}::date`
      )
    );
  return res?.total ?? 0;
}

/** Close a session exactly once. Returns the ended row, or null if it was already closed. */
export async function finalize(row: Row, now: number, reason: EndReason): Promise<Row | null> {
  const credit = creditOnEnd(clock(row), now, reason);
  const creditedSeconds = applyDailyCap(credit.creditedSeconds, await creditedThatDay(row));
  const [ended] = await db
    .update(schema.focusSessions)
    .set({
      status: 'ended',
      endedAt: new Date(now),
      endReason: reason,
      segmentStartedAt: null,
      accumulatedSeconds: credit.activeSeconds,
      creditedSeconds,
      completed: credit.completed
    })
    .where(and(eq(schema.focusSessions.id, row.id), ne(schema.focusSessions.status, 'ended')))
    .returning();

  if (ended?.completed && ended.taskId) {
    await db
      .update(schema.tasks)
      .set({ donePomodoros: sql`${schema.tasks.donePomodoros} + 1` })
      .where(and(eq(schema.tasks.id, ended.taskId), eq(schema.tasks.userId, ended.userId)));
  }
  return ended ?? null;
}

export async function start(userId: string, plannedSeconds: number, taskId: string | null) {
  const now = Date.now();
  const open = await getOpen(userId);
  if (open) await finalize(open, now, 'replaced');

  let tag: string | null = null;
  if (taskId) {
    const [task] = await db
      .select({ tag: schema.tasks.tag })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId)))
      .limit(1);
    if (!task) taskId = null;
    else tag = task.tag;
  }

  const at = new Date(now);
  const [row] = await db
    .insert(schema.focusSessions)
    .values({
      userId,
      taskId,
      tag,
      plannedSeconds,
      status: 'running',
      startedAt: at,
      segmentStartedAt: at,
      lastHeartbeatAt: at
    })
    .returning();
  return row!;
}

/**
 * Any request from the client proves the user is here now. If they come back
 * after the grace window, close the session first (they only get credit up to
 * the last heartbeat), then report what is open.
 */
export async function touch(userId: string): Promise<{ open: Row | null; ended: Row | null }> {
  const now = Date.now();
  const open = await getOpen(userId);
  if (!open) return { open: null, ended: null };
  const reason = sweepReason(clock(open), now);
  if (reason) return { open: null, ended: await finalize(open, now, reason) };
  return { open, ended: null };
}

export async function heartbeat(userId: string) {
  const { open, ended } = await touch(userId);
  if (!open) return { open: null, ended };
  if (open.status !== 'running') return { open, ended: null };
  const [row] = await db
    .update(schema.focusSessions)
    .set({ lastHeartbeatAt: new Date() })
    .where(eq(schema.focusSessions.id, open.id))
    .returning();
  return { open: row ?? open, ended: null };
}

export async function pause(userId: string) {
  const { open, ended } = await touch(userId);
  if (!open || open.status !== 'running') return { open, ended };
  const now = Date.now();
  const active = activeSeconds(clock(open), now);
  // Hitting the planned length while "pausing" is really a completion.
  if (active >= open.plannedSeconds) return { open: null, ended: await finalize(open, now, 'completed') };
  const [row] = await db
    .update(schema.focusSessions)
    .set({
      status: 'paused',
      accumulatedSeconds: active,
      segmentStartedAt: null,
      pausedAt: new Date(now),
      lastHeartbeatAt: new Date(now)
    })
    .where(eq(schema.focusSessions.id, open.id))
    .returning();
  return { open: row ?? null, ended: null };
}

export async function resume(userId: string) {
  const { open, ended } = await touch(userId);
  if (!open || open.status !== 'paused') return { open, ended };
  const at = new Date();
  const [row] = await db
    .update(schema.focusSessions)
    .set({ status: 'running', segmentStartedAt: at, pausedAt: null, lastHeartbeatAt: at })
    .where(eq(schema.focusSessions.id, open.id))
    .returning();
  return { open: row ?? null, ended: null };
}

export async function end(userId: string, reason: 'completed' | 'stopped') {
  const open = await getOpen(userId);
  if (!open) return null;
  return finalize(open, Date.now(), reason);
}

/** Close sessions nobody came back to. Runs on an interval. */
export async function sweep(): Promise<number> {
  const now = Date.now();
  const open = await db.select().from(schema.focusSessions).where(ne(schema.focusSessions.status, 'ended'));
  let closed = 0;
  for (const row of open) {
    const reason = sweepReason(clock(row), now);
    if (reason && (await finalize(row, now, reason))) closed++;
  }
  return closed;
}

export const SWEEP_INTERVAL_MS = 60_000;
