// Rules and API shapes shared by the web app and the API. See SPEC.md.

export const TIMEZONE = 'Africa/Cairo';

export const FOCUS_RULES = {
  /** Heartbeat interval the client uses while a session runs. */
  heartbeatSeconds: 60,
  /** Coming back within this long after the planned end still credits the full session. */
  returnGraceSeconds: 15 * 60,
  /** Sessions stopped early count only if at least this long. */
  minCreditSeconds: 5 * 60,
  /** Hard cap of credited focus per Cairo day. */
  dailyCapSeconds: 16 * 60 * 60,
  /** A paused session is closed after this long. */
  pauseTimeoutSeconds: 60 * 60,
  /** Client/server clock tolerance when a client reports completion. */
  completeToleranceSeconds: 5,
  /** Allowed planned lengths for a focus session. */
  minPlannedSeconds: 5 * 60,
  maxPlannedSeconds: 3 * 60 * 60,
  /** A day counts toward a streak when it has at least this much focus. */
  streakDaySeconds: 10 * 60
} as const;

export const LIMITS = {
  usernameMin: 3,
  usernameMax: 20,
  taskTitleMax: 200,
  maxTasks: 300,
  guestImportMaxSessions: 500
} as const;

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export type TimerMode = 'focus' | 'short' | 'long';

export interface Me {
  id: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  inviteCode: string;
  isAdmin: boolean;
}

export interface Task {
  id: string;
  title: string;
  done: boolean;
  estPomodoros: number;
  donePomodoros: number;
  tag: string | null;
  position: number;
}

export type FocusStatus = 'running' | 'paused' | 'ended';

export interface FocusSession {
  id: string;
  taskId: string | null;
  plannedSeconds: number;
  status: FocusStatus;
  /** Active seconds so far (server computed). */
  activeSeconds: number;
  /** ISO time the session would end if it keeps running; null when paused/ended. */
  plannedEndAt: string | null;
  creditedSeconds: number;
  completed: boolean;
}

export interface GuestSessionImport {
  startedAt: string;
  seconds: number;
  completed: boolean;
}

export interface GuestTaskImport {
  title: string;
  done: boolean;
  estPomodoros: number;
  donePomodoros: number;
}

export type LeaderboardPeriod = 'week' | 'month' | 'all';

export interface LeaderboardRow {
  userId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  seconds: number;
  sessions: number;
  streak: number;
  isMe: boolean;
}

export interface FriendSummary {
  userId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
}

export interface FriendsPayload {
  friends: FriendSummary[];
  incoming: (FriendSummary & { requestId: string })[];
  outgoing: (FriendSummary & { requestId: string })[];
}

export interface TodaySummary {
  seconds: number;
  sessions: number;
  goalSeconds: number;
  streak: number;
  rank: number | null;
  friendsCount: number;
}

export interface StatsPayload {
  totalSeconds: number;
  sessions: number;
  longestStreak: number;
  currentStreak: number;
  dailyAverageSeconds: number;
  /** Cairo date (YYYY-MM-DD) → seconds, last 182 days. */
  days: Record<string, number>;
  tags: { tag: string; seconds: number }[];
}

/** YYYY-MM-DD of an instant in Cairo time. */
export function cairoDay(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
  return parts; // en-CA formats as YYYY-MM-DD
}

/** Add days to a YYYY-MM-DD string (calendar math, no timezone involved). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Current streak ending today (or yesterday, if today has nothing yet). */
export function streakFrom(days: Record<string, number>, today: string): number {
  const ok = (day: string) => (days[day] ?? 0) >= FOCUS_RULES.streakDaySeconds;
  let cursor = ok(today) ? today : addDays(today, -1);
  let n = 0;
  while (ok(cursor)) {
    n++;
    cursor = addDays(cursor, -1);
  }
  return n;
}

export function longestStreak(days: Record<string, number>): number {
  const sorted = Object.keys(days)
    .filter((d) => (days[d] ?? 0) >= FOCUS_RULES.streakDaySeconds)
    .sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h && m) return `${h}س ${m}د`;
  if (h) return `${h}س`;
  return `${m}د`;
}

// ---------- Rooms, chat, images (phase 2) ----------

export const ROOM_RULES = {
  maxOwnedRooms: 5,
  maxMembers: 20,
  nameMax: 40,
  messageMax: 2000,
  messagesPerMinute: 20,
  imagesPerMinute: 10,
  editWindowSeconds: 15 * 60,
  pageSize: 50,
  imageMaxBytes: 10 * 1024 * 1024,
  imageMaxWidth: 1600,
  imageQuality: 80,
  imageRetentionDays: 14
} as const;

export interface RoomTimer {
  focusMinutes: number;
  breakMinutes: number;
  running: boolean;
  /** ISO time the current running stretch began; null when stopped/paused. */
  startedAt: string | null;
  /** Seconds banked before startedAt. */
  elapsedSeconds: number;
}

export interface RoomPhase {
  phase: 'focus' | 'break';
  round: number;
  /** Seconds left in the current phase. */
  remaining: number;
  /** Length of the current phase in seconds. */
  length: number;
}

/** Where a shared room timer is at `now`. Focus and break repeat forever. */
export function roomPhase(t: RoomTimer, now = Date.now()): RoomPhase {
  const focus = t.focusMinutes * 60;
  const brk = t.breakMinutes * 60;
  const running = t.running && t.startedAt ? Math.floor((now - Date.parse(t.startedAt)) / 1000) : 0;
  const elapsed = Math.max(0, t.elapsedSeconds + running);
  const cycle = focus + brk;
  const round = Math.floor(elapsed / cycle) + 1;
  const into = elapsed % cycle;
  return into < focus
    ? { phase: 'focus', round, remaining: focus - into, length: focus }
    : { phase: 'break', round, remaining: cycle - into, length: brk };
}

export type RoomRole = 'owner' | 'member';

export interface RoomSummary {
  id: string;
  name: string;
  role: RoomRole;
  memberCount: number;
  inviteCode: string;
}

export type PresenceStatus = 'focus' | 'paused' | 'online' | 'offline';

export interface RoomMember {
  userId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  role: RoomRole;
  status: PresenceStatus;
  todaySeconds: number;
}

export interface RoomDetail extends RoomSummary {
  ownerId: string;
  timer: RoomTimer;
  members: RoomMember[];
}

export interface ChatImage {
  url: string;
  width: number;
  height: number;
  bytes: number;
  originalBytes: number;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  kind: 'text' | 'image' | 'system';
  body: string;
  user: { id: string; name: string; avatarUrl: string | null } | null;
  replyTo: { id: string; body: string; userName: string | null } | null;
  /** null for image messages whose file expired. */
  image: ChatImage | null;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
}
