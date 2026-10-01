import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOM_RULES, type ChatImage } from '@zenfocus/shared';
import { eq, lt } from 'drizzle-orm';
import sharp, { type OutputInfo } from 'sharp';
import { db, schema } from '../db/index.js';
import { env } from '../env.js';

const root = path.resolve(env.UPLOAD_DIR);
const URL_TTL_SECONDS = 6 * 3600;

export class BadImage extends Error {}

/**
 * Re-encode an upload as WebP. sharp drops all metadata (EXIF, GPS) unless asked
 * to keep it, and fails on anything that is not really an image.
 */
export async function storeImage(roomId: string, uploaderId: string, input: Buffer) {
  let out: { data: Buffer; info: OutputInfo };
  try {
    out = await sharp(input, { limitInputPixels: 50_000_000, animated: false })
      .rotate() // apply EXIF orientation before the metadata is dropped
      .resize({ width: ROOM_RULES.imageMaxWidth, height: ROOM_RULES.imageMaxWidth, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: ROOM_RULES.imageQuality })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new BadImage('not an image');
  }
  const id = randomUUID();
  const month = new Date().toISOString().slice(0, 7);
  const rel = `${month}/${id}.webp`;
  await mkdir(path.join(root, month), { recursive: true });
  await writeFile(path.join(root, rel), out.data);
  const [row] = await db
    .insert(schema.images)
    .values({
      id,
      roomId,
      uploaderId,
      path: rel,
      width: out.info.width,
      height: out.info.height,
      bytes: out.data.length,
      originalBytes: input.length,
      expiresAt: new Date(Date.now() + ROOM_RULES.imageRetentionDays * 86400_000)
    })
    .returning();
  return row!;
}

function sign(id: string, exp: number) {
  return createHmac('sha256', env.imageSecret).update(`${id}.${exp}`).digest('base64url');
}

/** URL valid for a few hours; only room members ever receive it. */
export function chatImage(row: typeof schema.images.$inferSelect): ChatImage {
  // Round expiry to the hour so URLs stay cacheable between message fetches.
  const exp = Math.ceil((Date.now() / 1000 + URL_TTL_SECONDS) / 3600) * 3600;
  return {
    url: `/api/images/${row.id}?exp=${exp}&sig=${sign(row.id, exp)}`,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    originalBytes: row.originalBytes
  };
}

export function verifySignature(id: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const a = Buffer.from(sign(id, exp));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function imageFile(rel: string) {
  return {
    stream: () => createReadStream(path.join(root, rel)),
    accelPath: env.ACCEL_REDIRECT_PREFIX ? `${env.ACCEL_REDIRECT_PREFIX.replace(/\/$/, '')}/${rel}` : null
  };
}

/** Delete expired images (files and rows). Messages keep a "expired image" placeholder. */
export async function purgeExpiredImages(): Promise<number> {
  const expired = await db.delete(schema.images).where(lt(schema.images.expiresAt, new Date())).returning();
  for (const img of expired) await rm(path.join(root, img.path), { force: true });
  return expired.length;
}

/** Remove a room's image files before the room (and its image rows) is deleted. */
export async function purgeRoomImages(roomId: string) {
  const rows = await db.select({ path: schema.images.path }).from(schema.images).where(eq(schema.images.roomId, roomId));
  for (const r of rows) await rm(path.join(root, r.path), { force: true });
}
