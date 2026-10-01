import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { sql } from 'drizzle-orm';
import { TIMEZONE } from '@zenfocus/shared';
import { env } from '../env.js';
import * as schema from './schema.js';

// Migrations live next to package.json in both dev (src/db) and build (dist).
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, here.endsWith('db') ? '../../drizzle' : '../drizzle');

function create() {
  if (env.DATABASE_URL) {
    const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });
    const db = drizzlePg(pool, { schema });
    return { db, migrate: () => migratePg(db, { migrationsFolder }), close: () => pool.end() };
  }
  const client = new PGlite(env.PGLITE_DIR);
  const db = drizzlePglite(client, { schema });
  return { db, migrate: () => migratePglite(db, { migrationsFolder }), close: () => client.close() };
}

const handle = create();

// Both drivers expose the same query builder; type against the node-postgres one.
export const db = handle.db as unknown as ReturnType<typeof drizzlePg<typeof schema>>;
export const runMigrations = handle.migrate;
export const closeDb = handle.close;
export { schema };

/** Cairo timezone as an inline SQL literal (a bound parameter breaks GROUP BY matching). */
export const tzSql = sql.raw(`'${TIMEZONE}'`);
