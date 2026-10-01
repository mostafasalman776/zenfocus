import type {
  FocusSession,
  FriendsPayload,
  GuestSessionImport,
  GuestTaskImport,
  LeaderboardPeriod,
  LeaderboardRow,
  Me,
  StatsPayload,
  Task,
  TodaySummary
} from '@zenfocus/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string
  ) {
    super(code);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'request_failed');
  return data as T;
}

export interface FocusResult {
  session: FocusSession | null;
  ended: FocusSession | null;
}

export const api = {
  providers: () => request<{ google: boolean; devLogin: boolean }>('GET', '/api/auth/providers'),
  devLogin: (name: string, invite?: string) =>
    request<{ ok: true; needsUsername: boolean }>('POST', '/api/auth/dev-login', { name, invite }),
  logout: () => request('POST', '/api/auth/logout'),

  me: () => request<{ me: Me | null }>('GET', '/api/me'),
  updateMe: (patch: { username?: string; name?: string; dailyGoalSeconds?: number }) =>
    request<{ me: Me }>('PATCH', '/api/me', patch),
  today: () => request<TodaySummary>('GET', '/api/me/today'),
  stats: () => request<StatsPayload>('GET', '/api/me/stats'),

  tasks: () => request<{ tasks: Task[] }>('GET', '/api/tasks'),
  addTask: (title: string, estPomodoros = 1) => request<{ task: Task }>('POST', '/api/tasks', { title, estPomodoros }),
  updateTask: (id: string, patch: Partial<Omit<Task, 'id'>>) =>
    request<{ task: Task }>('PATCH', `/api/tasks/${id}`, patch),
  deleteTask: (id: string) => request('DELETE', `/api/tasks/${id}`),

  focusActive: () => request<FocusResult>('GET', '/api/focus/active'),
  focusStart: (plannedSeconds: number, taskId: string | null) =>
    request<FocusResult>('POST', '/api/focus/start', { plannedSeconds, taskId }),
  focusHeartbeat: () => request<FocusResult>('POST', '/api/focus/heartbeat'),
  focusPause: () => request<FocusResult>('POST', '/api/focus/pause'),
  focusResume: () => request<FocusResult>('POST', '/api/focus/resume'),
  focusEnd: (reason: 'completed' | 'stopped') => request<FocusResult>('POST', '/api/focus/end', { reason }),

  friends: () => request<FriendsPayload>('GET', '/api/friends'),
  requestFriend: (username: string) =>
    request<{ status: 'requested' | 'friends' | 'already_friends' }>('POST', '/api/friends/requests', { username }),
  acceptFriend: (requestId: string) => request('POST', `/api/friends/requests/${requestId}/accept`),
  dropRequest: (requestId: string) => request('DELETE', `/api/friends/requests/${requestId}`),
  unfriend: (userId: string) => request('DELETE', `/api/friends/${userId}`),
  block: (userId: string) => request('POST', `/api/blocks/${userId}`),
  leaderboard: (period: LeaderboardPeriod) =>
    request<{ period: LeaderboardPeriod; rows: LeaderboardRow[] }>('GET', `/api/leaderboard?period=${period}`),

  importGuest: (data: { tasks: GuestTaskImport[]; sessions: GuestSessionImport[] }) =>
    request<{ tasks: number; sessions: number }>('POST', '/api/import/guest', data)
};
