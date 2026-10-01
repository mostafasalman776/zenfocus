import { describe, expect, it } from 'vitest';
import { applyDailyCap, creditOnEnd, sweepReason, type SessionClock } from './rules.js';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 1, 18, 0, 0);

function running(overrides: Partial<SessionClock> = {}): SessionClock {
  return {
    plannedSeconds: 25 * 60,
    accumulatedSeconds: 0,
    segmentStartedAt: T0,
    lastHeartbeatAt: T0,
    pausedAt: null,
    ...overrides
  };
}

describe('creditOnEnd', () => {
  it('credits the full session when the client completes on time', () => {
    const r = creditOnEnd(running({ lastHeartbeatAt: T0 + 24 * MIN }), T0 + 25 * MIN, 'completed');
    expect(r).toMatchObject({ creditedSeconds: 1500, completed: true });
  });

  it('tolerates a client that reports completion a few seconds early', () => {
    const r = creditOnEnd(running(), T0 + 25 * MIN - 3000, 'completed');
    expect(r.completed).toBe(true);
  });

  it('does not accept an early "completed" as a full session', () => {
    const r = creditOnEnd(running(), T0 + 10 * MIN, 'completed');
    expect(r).toMatchObject({ creditedSeconds: 600, completed: false });
  });

  it('credits a phone that slept the whole session and came back within grace', () => {
    // No heartbeat after start (screen locked), returns 10 minutes after the end.
    const r = creditOnEnd(running(), T0 + 35 * MIN, 'completed');
    expect(r).toMatchObject({ creditedSeconds: 1500, completed: true });
  });

  it('credits only up to the last heartbeat when coming back after grace', () => {
    const c = running({ lastHeartbeatAt: T0 + 12 * MIN });
    const r = creditOnEnd(c, T0 + 25 * MIN + 16 * MIN, 'completed');
    expect(r).toMatchObject({ creditedSeconds: 720, completed: false });
  });

  it('drops early stops shorter than the minimum', () => {
    const r = creditOnEnd(running(), T0 + 4 * MIN, 'stopped');
    expect(r).toMatchObject({ creditedSeconds: 0, completed: false, activeSeconds: 240 });
  });

  it('counts early stops of at least 5 minutes, without marking them complete', () => {
    const r = creditOnEnd(running(), T0 + 7 * MIN, 'stopped');
    expect(r).toMatchObject({ creditedSeconds: 420, completed: false });
  });

  it('does not count paused time', () => {
    // Ran 10 min, paused, resumed at T0+30 → 15 more minutes needed.
    const c = running({ accumulatedSeconds: 600, segmentStartedAt: T0 + 30 * MIN });
    const r = creditOnEnd(c, T0 + 45 * MIN, 'completed');
    expect(r).toMatchObject({ creditedSeconds: 1500, completed: true });
  });

  it('credits only the accumulated time for a paused session', () => {
    const c = running({ accumulatedSeconds: 900, segmentStartedAt: null, pausedAt: T0 + 15 * MIN });
    const r = creditOnEnd(c, T0 + 3 * 60 * MIN, 'pause_timeout');
    expect(r).toMatchObject({ creditedSeconds: 900, completed: false });
  });
});

describe('sweepReason', () => {
  it('leaves a running session alone inside the grace window', () => {
    expect(sweepReason(running(), T0 + 39 * MIN)).toBeNull();
  });

  it('expires a running session after the grace window', () => {
    expect(sweepReason(running(), T0 + 41 * MIN)).toBe('expired');
  });

  it('times out a long pause', () => {
    const c = running({ segmentStartedAt: null, pausedAt: T0 });
    expect(sweepReason(c, T0 + 61 * MIN)).toBe('pause_timeout');
  });
});

describe('applyDailyCap', () => {
  it('clamps to the 16h daily cap', () => {
    expect(applyDailyCap(3600, 15.5 * 3600)).toBe(1800);
    expect(applyDailyCap(3600, 17 * 3600)).toBe(0);
  });
});
