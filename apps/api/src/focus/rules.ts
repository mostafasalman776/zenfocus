import { FOCUS_RULES } from '@zenfocus/shared';

/** The server-side state of a focus session needed to credit it. Times in ms. */
export interface SessionClock {
  plannedSeconds: number;
  accumulatedSeconds: number;
  segmentStartedAt: number | null;
  lastHeartbeatAt: number;
  pausedAt: number | null;
}

export type EndReason =
  | 'completed' // client says the timer reached zero
  | 'stopped' // user stopped it early
  | 'replaced' // user started another session
  | 'expired' // sweeper: nobody came back within the grace window
  | 'pause_timeout'; // sweeper: paused for too long

export interface Credit {
  creditedSeconds: number;
  completed: boolean;
  activeSeconds: number;
}

const sec = (ms: number) => Math.floor(ms / 1000);

/** When a running session would reach its planned length, or null if paused. */
export function plannedEnd(c: SessionClock): number | null {
  if (c.segmentStartedAt === null) return null;
  return c.segmentStartedAt + (c.plannedSeconds - c.accumulatedSeconds) * 1000;
}

/** Active seconds right now, capped at the planned length. Used for display. */
export function activeSeconds(c: SessionClock, now: number): number {
  const running = c.segmentStartedAt === null ? 0 : sec(now - c.segmentStartedAt);
  return Math.min(c.plannedSeconds, c.accumulatedSeconds + Math.max(0, running));
}

/**
 * Whether the user is "back in time" to keep full credit.
 * A live request at `now` proves presence; after the grace window it does not
 * vouch for the time they were away.
 */
function withinGrace(c: SessionClock, now: number): boolean {
  const end = plannedEnd(c);
  return end === null || now <= end + FOCUS_RULES.returnGraceSeconds * 1000;
}

/**
 * Credit a session that is ending now. See SPEC.md "حساب وقت التركيز".
 * `now` is the server time the end is processed.
 */
export function creditOnEnd(c: SessionClock, now: number, reason: EndReason): Credit {
  let active: number;

  if (c.segmentStartedAt === null) {
    // Paused (or pause timeout): only what was accumulated.
    active = c.accumulatedSeconds;
  } else {
    const end = plannedEnd(c)!;
    let creditUntil: number;
    if (reason === 'expired' || !withinGrace(c, now)) {
      // Gone too long: trust only the last sign of life.
      creditUntil = Math.min(c.lastHeartbeatAt, end);
    } else if (reason === 'completed') {
      // Allow a little clock skew for a client that reports zero a bit early.
      const tolerance = FOCUS_RULES.completeToleranceSeconds * 1000;
      creditUntil = now + tolerance >= end ? end : now;
    } else {
      creditUntil = Math.min(now, end);
    }
    active = c.accumulatedSeconds + Math.max(0, sec(creditUntil - c.segmentStartedAt));
  }

  active = Math.min(active, c.plannedSeconds);
  const completed = active >= c.plannedSeconds;
  const creditedSeconds = completed || active >= FOCUS_RULES.minCreditSeconds ? active : 0;
  return { creditedSeconds, completed, activeSeconds: active };
}

/** Whether the sweeper should close this session, and why. */
export function sweepReason(c: SessionClock, now: number): EndReason | null {
  if (c.segmentStartedAt === null) {
    if (c.pausedAt !== null && now - c.pausedAt > FOCUS_RULES.pauseTimeoutSeconds * 1000) {
      return 'pause_timeout';
    }
    return null;
  }
  return withinGrace(c, now) ? null : 'expired';
}

/** Clamp a session's credit so the day's total never exceeds the daily cap. */
export function applyDailyCap(credited: number, alreadyCreditedToday: number): number {
  const room = Math.max(0, FOCUS_RULES.dailyCapSeconds - alreadyCreditedToday);
  return Math.min(credited, room);
}
