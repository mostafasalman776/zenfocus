import type { GuestSessionImport, Task } from '@zenfocus/shared';

// Guest mode keeps everything in this browser. All access is wrapped because
// storage can be unavailable (private mode, blocked site data).

const TASKS_KEY = 'zf.guest.tasks';
const SESSIONS_KEY = 'zf.guest.sessions';
const LEGACY_TASKS_KEY = 'tasks'; // the original ZenFocus page stored tasks here
const INVITE_KEY = 'zf.invite';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: guest data lives for this tab only */
  }
}

export function loadGuestTasks(): Task[] {
  const tasks = read<Task[] | null>(TASKS_KEY, null);
  if (tasks) return tasks;
  // One-time carry-over from the original ZenFocus page.
  const legacy = read<{ id: number; text: string; completed: boolean }[]>(LEGACY_TASKS_KEY, []);
  return legacy.map((t, i) => ({
    id: `g-${t.id}`,
    title: t.text,
    done: t.completed,
    estPomodoros: 1,
    donePomodoros: 0,
    tag: null,
    position: i
  }));
}

export const saveGuestTasks = (tasks: Task[]) => write(TASKS_KEY, tasks);

export function recordGuestSession(s: GuestSessionImport) {
  const all = read<GuestSessionImport[]>(SESSIONS_KEY, []);
  all.push(s);
  write(SESSIONS_KEY, all.slice(-500));
}

export const loadGuestSessions = () => read<GuestSessionImport[]>(SESSIONS_KEY, []);

export function hasGuestData(): boolean {
  return loadGuestTasks().length > 0 || loadGuestSessions().length > 0;
}

export function clearGuestData() {
  try {
    localStorage.removeItem(TASKS_KEY);
    localStorage.removeItem(SESSIONS_KEY);
    localStorage.removeItem(LEGACY_TASKS_KEY);
  } catch {
    /* ignore */
  }
}

export const saveInvite = (code: string) => write(INVITE_KEY, code);
export const loadInvite = () => read<string | null>(INVITE_KEY, null);
export function clearInvite() {
  try {
    localStorage.removeItem(INVITE_KEY);
  } catch {
    /* ignore */
  }
}

export function loadPref<T>(key: string, fallback: T): T {
  return read(`zf.pref.${key}`, fallback);
}
export const savePref = (key: string, value: unknown) => write(`zf.pref.${key}`, value);
