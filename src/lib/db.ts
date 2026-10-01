import { Pool, type PoolClient } from 'pg';

declare global { var _pgPool: Pool | undefined; }

// Reused across hot reloads so dev doesn't exhaust connections.
const pool = global._pgPool ?? new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
if (process.env.NODE_ENV !== 'production') global._pgPool = pool;

/**
 * Runs `fn` in a transaction with `app.user_id` set, which is what every RLS
 * policy in db/policies.sql reads.
 *
 * Two things here are load-bearing:
 *  - The third argument to set_config is `true`, meaning transaction-local.
 *    Without a surrounding transaction it is silently a no-op and every query
 *    returns zero rows.
 *  - DATABASE_URL must be the i3_app role. Superusers and table owners bypass
 *    RLS, which would void the entire authorization model without any error.
 */
export async function withUser<T>(
  userId: string | null,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('select set_config($1, $2, true)', ['app.user_id', userId ?? '']);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
