import { FOCUS_RULES, type Me, type Task } from '@zenfocus/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useTimer } from '../stores/timer';
import { api, type FocusResult } from './api';
import { loadGuestTasks, saveGuestTasks } from './guest';

export function useMe() {
  const q = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 5 * 60_000 });
  return { me: (q.data?.me ?? null) as Me | null, loading: q.isLoading };
}

// ---------- Tasks: server when signed in, localStorage for guests ----------

export interface TasksApi {
  tasks: Task[];
  add: (title: string, estPomodoros: number) => void;
  toggle: (task: Task) => void;
  remove: (task: Task) => void;
}

function useGuestTasks(): TasksApi {
  const [tasks, setTasks] = useState<Task[]>(() => loadGuestTasks());
  const update = useCallback((next: Task[]) => {
    setTasks(next);
    saveGuestTasks(next);
  }, []);
  return {
    tasks,
    add: (title, estPomodoros) =>
      update([
        ...tasks,
        {
          id: `g-${Date.now()}`,
          title,
          done: false,
          estPomodoros,
          donePomodoros: 0,
          tag: null,
          position: tasks.length
        }
      ]),
    toggle: (task) => update(tasks.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t))),
    remove: (task) => update(tasks.filter((t) => t.id !== task.id))
  };
}

function useServerTasks(enabled: boolean): TasksApi {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['tasks'], queryFn: api.tasks, enabled });
  const refresh = () => qc.invalidateQueries({ queryKey: ['tasks'] });
  const add = useMutation({
    mutationFn: (v: { title: string; est: number }) => api.addTask(v.title, v.est),
    onSettled: refresh
  });
  const toggle = useMutation({
    mutationFn: (t: Task) => api.updateTask(t.id, { done: !t.done }),
    onMutate: (t) =>
      qc.setQueryData<{ tasks: Task[] }>(['tasks'], (old) =>
        old ? { tasks: old.tasks.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)) } : old
      ),
    onSettled: refresh
  });
  const remove = useMutation({
    mutationFn: (t: Task) => api.deleteTask(t.id),
    onMutate: (t) =>
      qc.setQueryData<{ tasks: Task[] }>(['tasks'], (old) =>
        old ? { tasks: old.tasks.filter((x) => x.id !== t.id) } : old
      ),
    onSettled: refresh
  });
  return {
    tasks: q.data?.tasks ?? [],
    add: (title, est) => add.mutate({ title, est }),
    toggle: (t) => toggle.mutate(t),
    remove: (t) => remove.mutate(t)
  };
}

export function useTasks(me: Me | null): TasksApi {
  const guest = useGuestTasks();
  const server = useServerTasks(Boolean(me));
  return me ? server : guest;
}

// ---------- Timer engine: ticking, heartbeats, coming back ----------

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) socket = io({ path: '/api/socket.io', withCredentials: true });
  return socket;
}

function heartbeat(): Promise<FocusResult> {
  const s = getSocket();
  if (!s.connected) return api.focusHeartbeat();
  return new Promise((resolve, reject) => {
    s.timeout(10_000).emit('focus:heartbeat', (err: Error | null, res: FocusResult & { error?: string }) => {
      if (err || res.error) api.focusHeartbeat().then(resolve, reject);
      else resolve(res);
    });
  });
}

/** Mount once at the app root. */
export function useTimerEngine(me: Me | null) {
  const qc = useQueryClient();
  const status = useTimer((s) => s.status);
  const tracked = useTimer((s) => s.tracked);

  // Pick up a session left running on another device or before a reload.
  useEffect(() => {
    if (!me) return;
    api
      .focusActive()
      .then((r) => useTimer.getState().applyServer(r))
      .catch(() => undefined);
    const s = getSocket();
    return () => {
      s.disconnect();
      socket = null;
    };
  }, [me]);

  // Ticking. Remaining time is derived from endsAt, so a throttled or frozen
  // tab shows the right time as soon as it wakes up.
  useEffect(() => {
    if (status !== 'running') return;
    const id = setInterval(() => useTimer.getState().tick(), 250);
    return () => clearInterval(id);
  }, [status]);

  // Heartbeats while a tracked session runs.
  useEffect(() => {
    if (!me || !tracked || status !== 'running') return;
    const id = setInterval(() => {
      heartbeat()
        .then((r) => useTimer.getState().applyServer(r))
        .catch(() => undefined);
    }, FOCUS_RULES.heartbeatSeconds * 1000);
    return () => clearInterval(id);
  }, [me, tracked, status]);

  // Coming back to the tab (phone unlocked): reconcile with the server first.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const s = useTimer.getState();
      if (me && s.tracked) {
        api
          .focusActive()
          .then((r) => {
            useTimer.getState().applyServer(r);
            useTimer.getState().tick();
          })
          .catch(() => useTimer.getState().tick());
      } else {
        s.tick();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [me]);

  // Refresh numbers after a session ends.
  const notice = useTimer((s) => s.notice);
  useEffect(() => {
    if (notice && me) {
      void qc.invalidateQueries({ queryKey: ['today'] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    }
  }, [notice, me, qc]);
}

// ---------- Screen wake lock ----------

export function useWakeLock(active: boolean, wanted: boolean) {
  useEffect(() => {
    if (!active || !wanted || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = () => {
      navigator.wakeLock
        .request('screen')
        .then((l) => {
          if (cancelled) void l.release();
          else lock = l;
        })
        .catch(() => undefined);
    };
    acquire();
    // The lock is dropped when the tab is hidden; take it again on return.
    const onVisible = () => document.visibilityState === 'visible' && acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
    };
  }, [active, wanted]);
}

export const wakeLockSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
