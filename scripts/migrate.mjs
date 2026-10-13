import nextEnv from '@next/env';
import { Pool } from 'pg';
import { fileURLToPath } from 'node:url';
import { applyMigrations } from './lib/migrations.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
nextEnv.loadEnvConfig(root);
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
let client;
try {
  client = await pool.connect();
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(734203001)');
  await applyMigrations(client);
  await client.query('COMMIT');
  console.log('Database migrations complete.');
} catch (error) {
  if (client) await client.query('ROLLBACK').catch(() => {});
  // pg error messages/codes do not include the connection string.
  console.error(`Migration failed; nothing was applied. ${error?.code ? `[${error.code}] ` : ''}${error?.message ?? ''}`);
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
