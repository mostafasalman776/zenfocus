import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    googleSub: text('google_sub').unique(),
    email: text('email'),
    name: text('name').notNull(),
    username: text('username'),
    avatarUrl: text('avatar_url'),
    inviteCode: text('invite_code').notNull(),
    dailyGoalSeconds: integer('daily_goal_seconds').notNull().default(4 * 3600),
    createdAt: createdAt()
  },
  (t) => [
    uniqueIndex('users_username_uq').on(t.username),
    uniqueIndex('users_invite_code_uq').on(t.inviteCode)
  ]
);

export const authSessions = pgTable('auth_sessions', {
  // sha256 of the cookie token; the raw token is never stored.
  id: text('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt()
});

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    done: boolean('done').notNull().default(false),
    estPomodoros: integer('est_pomodoros').notNull().default(1),
    donePomodoros: integer('done_pomodoros').notNull().default(0),
    tag: text('tag'),
    position: integer('position').notNull().default(0),
    doneAt: timestamp('done_at', { withTimezone: true }),
    createdAt: createdAt()
  },
  (t) => [index('tasks_user_idx').on(t.userId)]
);

export const focusSessions = pgTable(
  'focus_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    tag: text('tag'),
    plannedSeconds: integer('planned_seconds').notNull(),
    status: text('status', { enum: ['running', 'paused', 'ended'] }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    /** Active seconds accumulated before the current running segment. */
    accumulatedSeconds: integer('accumulated_seconds').notNull().default(0),
    /** Start of the current running segment; null while paused or ended. */
    segmentStartedAt: timestamp('segment_started_at', { withTimezone: true }),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endReason: text('end_reason'),
    creditedSeconds: integer('credited_seconds').notNull().default(0),
    completed: boolean('completed').notNull().default(false),
    /** Imported from guest mode: shown in personal stats, never on leaderboards. */
    imported: boolean('imported').notNull().default(false),
    createdAt: createdAt()
  },
  (t) => [
    index('focus_user_started_idx').on(t.userId, t.startedAt),
    index('focus_status_idx').on(t.status),
    // At most one open session per user.
    uniqueIndex('focus_one_open_uq')
      .on(t.userId)
      .where(sql`status <> 'ended'`)
  ]
);

export const friendRequests = pgTable(
  'friend_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromUserId: uuid('from_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    toUserId: uuid('to_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt()
  },
  (t) => [uniqueIndex('friend_req_pair_uq').on(t.fromUserId, t.toUserId)]
);

/** Stored in both directions so "my friends" is a single indexed lookup. */
export const friendships = pgTable(
  'friendships',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    friendId: uuid('friend_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt()
  },
  (t) => [primaryKey({ columns: [t.userId, t.friendId] })]
);

export const blocks = pgTable(
  'blocks',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: uuid('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt()
  },
  (t) => [primaryKey({ columns: [t.userId, t.blockedId] })]
);

// ---------- Rooms (phase 2) ----------

export const rooms = pgTable(
  'rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    inviteCode: text('invite_code').notNull(),
    // Shared timer. Phases repeat focus → break; the current phase is derived
    // from elapsed running time, so no scheduler is needed.
    focusMinutes: integer('focus_minutes').notNull().default(25),
    breakMinutes: integer('break_minutes').notNull().default(5),
    timerStartedAt: timestamp('timer_started_at', { withTimezone: true }),
    /** Elapsed seconds banked before timerStartedAt (pauses). */
    timerElapsedSeconds: integer('timer_elapsed_seconds').notNull().default(0),
    timerRunning: boolean('timer_running').notNull().default(false),
    createdAt: createdAt()
  },
  (t) => [uniqueIndex('rooms_invite_code_uq').on(t.inviteCode), index('rooms_owner_idx').on(t.ownerId)]
);

export const roomMembers = pgTable(
  'room_members',
  {
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'member'] }).notNull().default('member'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [primaryKey({ columns: [t.roomId, t.userId] }), index('room_members_user_idx').on(t.userId)]
);

export const images = pgTable(
  'images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    uploaderId: uuid('uploader_id').references(() => users.id, { onDelete: 'set null' }),
    /** Path relative to UPLOAD_DIR. */
    path: text('path').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    bytes: integer('bytes').notNull(),
    originalBytes: integer('original_bytes').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt()
  },
  (t) => [index('images_expires_idx').on(t.expiresAt)]
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    /** Null for system messages. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind', { enum: ['text', 'image', 'system'] }).notNull(),
    body: text('body').notNull().default(''),
    replyToId: uuid('reply_to_id'),
    imageId: uuid('image_id').references(() => images.id, { onDelete: 'set null' }),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt()
  },
  (t) => [index('messages_room_created_idx').on(t.roomId, t.createdAt)]
);

export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  reporterId: uuid('reporter_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  messageId: uuid('message_id')
    .notNull()
    .references(() => messages.id, { onDelete: 'cascade' }),
  reason: text('reason').notNull().default(''),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: createdAt()
});
