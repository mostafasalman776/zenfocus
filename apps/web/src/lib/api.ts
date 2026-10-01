import type {
  ChatMessage,
  FocusSession,
  RoomDetail,
  RoomSummary,
  RoomTimer,
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
  const isForm = body instanceof FormData;
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined || isForm ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body)
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

  rooms: () => request<{ rooms: RoomSummary[] }>('GET', '/api/rooms'),
  createRoom: (name: string) => request<{ room: RoomDetail }>('POST', '/api/rooms', { name }),
  room: (id: string) => request<{ room: RoomDetail }>('GET', `/api/rooms/${id}`),
  updateRoom: (id: string, patch: { name?: string; focusMinutes?: number; breakMinutes?: number }) =>
    request<{ room: RoomDetail }>('PATCH', `/api/rooms/${id}`, patch),
  deleteRoom: (id: string) => request('DELETE', `/api/rooms/${id}`),
  newRoomInvite: (id: string) => request<{ inviteCode: string }>('POST', `/api/rooms/${id}/invite`),
  roomInvite: (code: string) =>
    request<{ roomId: string; name: string; memberCount: number; isMember: boolean; full: boolean }>(
      'GET',
      `/api/rooms/invite/${encodeURIComponent(code)}`
    ),
  joinRoom: (code: string) => request<{ roomId: string }>('POST', '/api/rooms/join', { code }),
  leaveRoom: (id: string) => request('POST', `/api/rooms/${id}/leave`),
  kick: (id: string, userId: string) => request('DELETE', `/api/rooms/${id}/members/${userId}`),
  roomTimer: (id: string, action: 'start' | 'pause' | 'reset' | 'skip') =>
    request<{ timer: RoomTimer }>('POST', `/api/rooms/${id}/timer`, { action }),
  roomLeaderboard: (id: string, period: LeaderboardPeriod) =>
    request<{ period: LeaderboardPeriod; rows: LeaderboardRow[] }>('GET', `/api/rooms/${id}/leaderboard?period=${period}`),
  messages: (id: string, before?: string) =>
    request<{ messages: ChatMessage[] }>(
      'GET',
      `/api/rooms/${id}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`
    ),
  sendMessage: (id: string, body: string, replyToId: string | null) =>
    request<{ message: ChatMessage }>('POST', `/api/rooms/${id}/messages`, { body, replyToId }),
  sendImage: (id: string, file: Blob, caption: string) => {
    const form = new FormData();
    form.append('caption', caption);
    form.append('file', file, 'image.webp');
    return request<{ message: ChatMessage }>('POST', `/api/rooms/${id}/images`, form);
  },
  editMessage: (id: string, body: string) => request<{ message: ChatMessage }>('PATCH', `/api/messages/${id}`, { body }),
  deleteMessage: (id: string) => request('DELETE', `/api/messages/${id}`),
  reportMessage: (id: string, reason: string) => request('POST', `/api/messages/${id}/report`, { reason }),
  reports: () =>
    request<{ reports: { id: string; reason: string; createdAt: string; message: ChatMessage | null }[] }>(
      'GET',
      '/api/admin/reports'
    ),
  resolveReport: (id: string, deleteMessage: boolean) =>
    request('POST', `/api/admin/reports/${id}/resolve`, { deleteMessage }),

  importGuest: (data: { tasks: GuestTaskImport[]; sessions: GuestSessionImport[] }) =>
    request<{ tasks: number; sessions: number }>('POST', '/api/import/guest', data)
};
