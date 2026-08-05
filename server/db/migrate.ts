import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ADVISORY_LOCK_KEY = 8_675_309;

/**
 * Applies pending .sql files in name order, inside a transaction, under an
 * advisory lock so two instances starting at once can't both migrate.
 * Runs from `npm run serve` before listen(), so a deploy needs no manual step.
 */
export async function migrate(): Promise<void> {
  const files = fs
    .readdirSync(__dirname)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = await pool.connect();
  try {
    await client.query(`select pg_advisory_lock($1)`, [ADVISORY_LOCK_KEY]);
    await client.query(`
      create table if not exists schema_migrations (
        name       text primary key,
        applied_at timestamptz not null default now()
      )
    `);
    const { rows } = await client.query<{ name: string }>('select name from schema_migrations');
    const applied = new Set(rows.map((r) => r.name));

    const pending = files.filter((f) => !applied.has(f));
    if (!pending.length) {
      console.log(`[db] schema up to date (${files.length} migrations)`);
      return;
    }

    for (const file of pending) {
      const sql = fs.readFileSync(path.join(__dirname, file), 'utf8');
      console.log(`[db] applying ${file}`);
      try {
        await client.query('begin');
        await client.query(sql);
        await client.query('insert into schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
      } catch (err) {
        await client.query('rollback').catch(() => {});
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
    console.log(`[db] applied ${pending.length} migration(s)`);
  } finally {
    await client.query(`select pg_advisory_unlock($1)`, [ADVISORY_LOCK_KEY]).catch(() => {});
    client.release();
  }
}
