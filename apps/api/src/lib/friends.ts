import { and, eq, or } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export async function friendIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: schema.friendships.friendId })
    .from(schema.friendships)
    .where(eq(schema.friendships.userId, userId));
  return rows.map((r) => r.id);
}

export async function areFriends(a: string, b: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.friendships.friendId })
    .from(schema.friendships)
    .where(and(eq(schema.friendships.userId, a), eq(schema.friendships.friendId, b)))
    .limit(1);
  return rows.length > 0;
}

/** Either side blocked the other. */
export async function isBlockedEitherWay(a: string, b: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.blocks.userId })
    .from(schema.blocks)
    .where(
      or(
        and(eq(schema.blocks.userId, a), eq(schema.blocks.blockedId, b)),
        and(eq(schema.blocks.userId, b), eq(schema.blocks.blockedId, a))
      )
    )
    .limit(1);
  return rows.length > 0;
}

export async function makeFriends(a: string, b: string) {
  if (a === b) return;
  await db
    .insert(schema.friendships)
    .values([
      { userId: a, friendId: b },
      { userId: b, friendId: a }
    ])
    .onConflictDoNothing();
  // Any pending request between the two is now settled.
  await db
    .delete(schema.friendRequests)
    .where(
      or(
        and(eq(schema.friendRequests.fromUserId, a), eq(schema.friendRequests.toUserId, b)),
        and(eq(schema.friendRequests.fromUserId, b), eq(schema.friendRequests.toUserId, a))
      )
    );
}

export async function unfriend(a: string, b: string) {
  await db
    .delete(schema.friendships)
    .where(
      or(
        and(eq(schema.friendships.userId, a), eq(schema.friendships.friendId, b)),
        and(eq(schema.friendships.userId, b), eq(schema.friendships.friendId, a))
      )
    );
}
