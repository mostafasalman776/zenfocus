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
