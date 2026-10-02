import { FOCUS_RULES, type TimerMode } from '@zenfocus/shared';
import { create } from 'zustand';
import { api, type FocusResult } from '../lib/api';
import { playChime } from '../lib/audio';
import { loadPref, recordGuestSession, savePref } from '../lib/guest';

export type TimerStatus = 'idle' | 'running' | 'paused';

export const MODE_LABEL: Record<TimerMode, string> = {
  focus: 'تركيز',
  short: 'استراحة قصيرة',
  long: 'استراحة طويلة'
};

const DEFAULT_MINUTES: Record<TimerMode, number> = { focus: 25, short: 5, long: 15 };
const LONG_BREAK_EVERY = 4;

interface TimerState {
  mode: TimerMode;
  minutes: Record<TimerMode, number>;
  status: TimerStatus;
  /** Epoch ms the current run reaches zero (running only). */
  endsAt: number | null;
  /** Seconds left, authoritative while idle/paused; derived from endsAt while running. */
  remaining: number;
  /** Focus sessions finished in the current cycle (resets after a long break). */
  cycle: number;
  taskId: string | null;
  /** Whether this run is tracked by the server (signed-in focus session). */
  tracked: boolean;
  /** Guest bookkeeping: when the focus run started. */
  guestStartedAt: number | null;
  notice: string | null;
  keepAwake: boolean;

  setKeepAwake: (on: boolean) => void;
  setMode: (mode: TimerMode) => void;
  setTask: (taskId: string | null) => void;
  start: (signedIn: boolean) => Promise<void>;
  /** Start a focus run of a specific length (used to follow a room timer). */
  startFor: (seconds: number, signedIn: boolean) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  tick: () => void;
  applyServer: (r: FocusResult) => void;
  clearNotice: () => void;
}

const minutes = loadPref<Record<TimerMode, number>>('minutes', DEFAULT_MINUTES);

function formatCredit(seconds: number) {
  const m = Math.round(seconds / 60);
  return m ? `تم احتساب ${m} دقيقة` : 'لم تُحتسب الجلسة (أقل من 5 دقائق)';
}

function notify(title: string, body: string) {
  try {
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      new Notification(title, { body, icon: '/favicon.svg' });
    }
  } catch {
    /* notifications are best effort */
  }
}

export const useTimer = create<TimerState>((set, get) => {
  const secondsFor = (mode: TimerMode) => get().minutes[mode] * 60;

  function idleIn(mode: TimerMode, extra: Partial<TimerState> = {}) {
    set({
      mode,
      status: 'idle',
      endsAt: null,
      remaining: get().minutes[mode] * 60,
      tracked: false,
      guestStartedAt: null,
      ...extra
    });
  }

  function guestRecord(completed: boolean) {
    const s = get();
    if (s.tracked || s.mode !== 'focus' || s.guestStartedAt === null) return;
    const left = s.endsAt ? Math.max(0, Math.ceil((s.endsAt - Date.now()) / 1000)) : s.remaining;
    const seconds = completed ? secondsFor('focus') : Math.max(0, secondsFor('focus') - left);
    if (completed || seconds >= FOCUS_RULES.minCreditSeconds) {
      recordGuestSession({ startedAt: new Date(s.guestStartedAt).toISOString(), seconds, completed });
    }
  }

  /** Timer hit zero on this device. */
  async function finish() {
    const s = get();
    playChime();
    if (s.mode === 'focus') {
      let notice = 'أحسنت! وقت الاستراحة';
      if (s.tracked) {
        try {
          const r = await api.focusEnd('completed');
          if (r.ended) notice = `أحسنت! ${formatCredit(r.ended.creditedSeconds)}`;
        } catch {
          notice = 'انتهت الجلسة، لكن تعذّر الاتصال بالخادم.';
        }
      } else {
        guestRecord(true);
      }
      notify('انتهت جلسة التركيز', 'وقت الاستراحة');
      const cycle = s.cycle + 1;
      const next: TimerMode = cycle % LONG_BREAK_EVERY === 0 ? 'long' : 'short';
      idleIn(next, { cycle: next === 'long' ? 0 : cycle, notice });
    } else {
      notify('انتهت الاستراحة', 'حان وقت التركيز');
      idleIn('focus', { notice: 'انتهت الاستراحة' });
    }
  }

  return {
    mode: 'focus',
    minutes,
    status: 'idle',
    endsAt: null,
    remaining: minutes.focus * 60,
    cycle: 0,
    taskId: null,
    tracked: false,
    guestStartedAt: null,
    notice: null,
    keepAwake: loadPref('keepAwake', false),

    setKeepAwake(on) {
      savePref('keepAwake', on);
      set({ keepAwake: on });
    },

    setMode(mode) {
      if (get().status !== 'idle') return;
      idleIn(mode);
    },

    setTask(taskId) {
      set({ taskId });
    },

    async start(signedIn) {
      const s = get();
      const total = s.remaining || secondsFor(s.mode);
      if ('Notification' in window && Notification.permission === 'default') {
        void Notification.requestPermission().catch(() => undefined);
      }
      if (s.mode === 'focus' && signedIn) {
        const r = await api.focusStart(total, s.taskId);
        set({ tracked: true });
        get().applyServer(r);
        return;
      }
      set({
        status: 'running',
        endsAt: Date.now() + total * 1000,
        tracked: false,
        guestStartedAt: s.mode === 'focus' ? Date.now() : null
      });
    },

    async startFor(seconds, signedIn) {
      if (get().status !== 'idle') return;
      set({ mode: 'focus', remaining: seconds });
      await get().start(signedIn);
    },

    async pause() {
      const s = get();
      if (s.status !== 'running') return;
      if (s.tracked) {
        get().applyServer(await api.focusPause());
        return;
      }
      const remaining = Math.max(0, Math.ceil(((s.endsAt ?? 0) - Date.now()) / 1000));
      set({ status: 'paused', endsAt: null, remaining });
    },

    async resume() {
      const s = get();
      if (s.status !== 'paused') return;
      if (s.tracked) {
        get().applyServer(await api.focusResume());
        return;
      }
      set({ status: 'running', endsAt: Date.now() + s.remaining * 1000 });
    },

    async stop() {
      const s = get();
      let notice: string | null = null;
      if (s.tracked) {
        try {
          const r = await api.focusEnd('stopped');
          if (r.ended) notice = formatCredit(r.ended.creditedSeconds);
        } catch {
          notice = 'تعذّر الاتصال بالخادم';
        }
      } else if (s.status !== 'idle') {
        guestRecord(false);
      }
      idleIn(s.mode, { notice });
    },

    tick() {
      const s = get();
      if (s.status !== 'running' || s.endsAt === null) return;
      const remaining = Math.max(0, Math.ceil((s.endsAt - Date.now()) / 1000));
      if (remaining !== s.remaining) set({ remaining });
      if (remaining === 0) {
        set({ status: 'idle', endsAt: null });
        void finish();
      }
    },

    /** Adopt the server's view of the tracked session. */
    applyServer(r) {
      const s = get();
      if (r.session) {
        const remaining = Math.max(0, r.session.plannedSeconds - r.session.activeSeconds);
        set({
          mode: 'focus',
          tracked: true,
          taskId: r.session.taskId ?? s.taskId,
          status: r.session.status === 'paused' ? 'paused' : 'running',
          endsAt: r.session.plannedEndAt ? new Date(r.session.plannedEndAt).getTime() : null,
          remaining
        });
        return;
      }
      if (r.ended && s.tracked && s.status !== 'idle') {
        // The server closed it while we were away (grace window passed).
        idleIn('focus', { notice: `انتهت الجلسة أثناء غيابك. ${formatCredit(r.ended.creditedSeconds)}` });
      }
    },

    clearNotice() {
      set({ notice: null });
    }
  };
});

export function setModeMinutes(mode: TimerMode, value: number) {
  const next = { ...useTimer.getState().minutes, [mode]: value };
  savePref('minutes', next);
  useTimer.setState({ minutes: next });
  if (useTimer.getState().status === 'idle' && useTimer.getState().mode === mode) {
    useTimer.setState({ remaining: value * 60 });
  }
}
