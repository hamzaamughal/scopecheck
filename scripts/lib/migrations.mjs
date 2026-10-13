import { readdir, readFile } from 'node:fs/promises';

export const BASELINE_MIGRATION = '001_initial.sql';
const migrationsDir = new URL('../../db/migrations/', import.meta.url);

export async function readMigrations() {
  const names = (await readdir(migrationsDir)).filter(name => name.endsWith('.sql')).sort();
  return Promise.all(names.map(async name => ({ name, sql: await readFile(new URL(name, migrationsDir), 'utf8') })));
}

// Runs pending migrations on an open transaction, resolving unqualified names through search_path.
// The caller owns BEGIN/COMMIT/ROLLBACK and the advisory lock.
export async function applyMigrations(client, log = console.log) {
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  for (const { name, sql } of await readMigrations()) {
    if (!sql.trim()) continue;
    const existing = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
    if (existing.rowCount) continue;

    if (name === BASELINE_MIGRATION) {
      const { rows: [state] } = await client.query(
        "SELECT to_regclass('projects') IS NOT NULL AS projects, to_regclass('requests') IS NOT NULL AS requests",
      );
      if (state.projects !== state.requests) {
        throw new Error('Only one of projects/requests exists. Fix the schema manually before migrating.');
      }
      if (state.projects) {
        // Database predates the baseline file: adopt it instead of recreating existing tables.
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        log(`Recorded ${name} as baseline (existing tables kept unchanged)`);
        continue;
      }
    }

    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    log(`Applied ${name}`);
  }
}
