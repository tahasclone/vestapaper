import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error(
    'DATABASE_URL is not set. Create a free Postgres at neon.com and set it,\n' +
      'e.g. DATABASE_URL="postgresql://user:pass@host-pooler.neon.tech/db?sslmode=require"',
  );
}

/**
 * A real pool rather than a per-request HTTP driver: this is a long-lived Node
 * process, not a serverless function. `max: 3` respects Neon's free connection
 * ceiling, and the generous connect timeout absorbs its ~300-500ms
 * auto-resume after five idle minutes.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 8_000,
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? undefined
    : { rejectUnauthorized: true },
});

pool.on('error', (err) => {
  // A pooled connection dying in the background must not take the process down.
  console.error('[db] idle client error:', err.message);
});

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as any[]);
}

/** First row or null. */
export async function one<T extends pg.QueryResultRow = any>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const res = await query<T>(text, params);
  return res.rows[0] ?? null;
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
