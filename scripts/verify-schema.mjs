// Read-only check: builds every migration from scratch in a temporary schema, compares the result
// with the live schema, then ROLLS BACK. Nothing is created, changed, or recorded in the database.
// Usage: npm run db:verify [-- --live-schema public]
import nextEnv from '@next/env';
import { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BASELINE_MIGRATION, applyMigrations, readMigrations } from './lib/migrations.mjs';

nextEnv.loadEnvConfig(fileURLToPath(new URL('../', import.meta.url)));
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing.');
const flag = process.argv.indexOf('--live-schema');
const liveSchema = flag > -1 ? process.argv[flag + 1] : 'public';
if (!/^[a-z_][a-z0-9_]*$/.test(liveSchema ?? '')) throw new Error('Invalid --live-schema value.');
const freshSchema = `scopecheck_verify_${randomBytes(4).toString('hex')}`;

async function describe(client, schema) {
  await client.query(`SET LOCAL search_path TO ${schema}`); // FK/default text is unqualified for this schema
  // Extension types (pgvector) live in public and are written schema-qualified in migrations.
  const strip = text => text.replaceAll(`${schema}.`, '').replaceAll('public.', '');
  const tables = new Map();
  const table = name => tables.get(name) ?? tables.set(name, { columns: new Map(), constraints: new Map(), indexes: new Map() }).get(name);
  const columns = await client.query(
    `SELECT c.relname AS t, a.attname AS n,
       format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
       || COALESCE(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), '') AS def
     FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
     WHERE s.nspname = $1 AND c.relkind IN ('r', 'p')`, [schema]);
  for (const r of columns.rows) table(r.t).columns.set(r.n, strip(r.def));
  const constraints = await client.query(
    `SELECT c.relname AS t, k.conname AS n, pg_get_constraintdef(k.oid) AS def
     FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace s ON s.oid = c.relnamespace
     WHERE s.nspname = $1`, [schema]);
  for (const r of constraints.rows) table(r.t).constraints.set(r.n, strip(r.def));
  const indexes = await client.query('SELECT tablename AS t, indexname AS n, indexdef AS def FROM pg_indexes WHERE schemaname = $1', [schema]);
  for (const r of indexes.rows) table(r.t).indexes.set(r.n, strip(r.def));
  return tables;
}

function compare(fresh, live) {
  const drift = [];
  for (const [name, f] of fresh) {
    if (name === 'schema_migrations') continue;
    const l = live.get(name);
    if (!l) { drift.push(`missing table in live: ${name}`); continue; }
    for (const kind of ['columns', 'constraints', 'indexes']) {
      for (const [key, def] of f[kind]) {
        const liveDef = l[kind].get(key);
        if (liveDef === undefined) drift.push(`${name} ${kind}: "${key}" only in migrations -> ${def}`);
        else if (liveDef !== def) drift.push(`${name} ${kind}: "${key}" differs\n    migrations: ${def}\n    live:       ${liveDef}`);
      }
      for (const [key, def] of l[kind]) {
        if (!f[kind].has(key)) drift.push(`${name} ${kind}: "${key}" only in live -> ${def}`);
      }
    }
  }
  const extra = [...live.keys()].filter(name => !fresh.has(name));
  return { drift, extra };
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
let client;
try {
  client = await pool.connect();
  await client.query('BEGIN');
  await client.query("SET LOCAL statement_timeout = '30s'");
  await client.query("SET LOCAL lock_timeout = '5s'");

  const ledger = await client.query(`SELECT to_regclass('${liveSchema}.schema_migrations') IS NOT NULL AS present`);
  const applied = ledger.rows[0].present
    ? new Set((await client.query(`SELECT name FROM ${liveSchema}.schema_migrations`)).rows.map(r => r.name)) : new Set();
  const pending = (await readMigrations()).filter(m => m.sql.trim() && !applied.has(m.name)).map(m => m.name);

  await client.query(`CREATE SCHEMA ${freshSchema}`);
  await client.query(`SET LOCAL search_path TO ${freshSchema}`);
  await applyMigrations(client, () => {});
  const { drift, extra } = compare(await describe(client, freshSchema), await describe(client, liveSchema));

  console.log(`Fresh build of all migrations: OK (temporary schema rolled back)`);
  console.log(`Pending on ${liveSchema}: ${pending.length ? pending.join(', ') : 'none'}`
    + (pending.includes(BASELINE_MIGRATION) ? ` (${BASELINE_MIGRATION} will be recorded as baseline, not executed)` : ''));
  if (extra.length) console.log(`Live-only tables (not created by migrations): ${extra.join(', ')}`);
  if (drift.length) {
    console.log(`\nSchema drift (${drift.length}):\n- ${drift.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log('No drift: a fresh database matches the live schema.');
  }
} catch (error) {
  console.error(`Verification failed. ${error?.code ? `[${error.code}] ` : ''}${error?.message ?? ''}`);
  process.exitCode = 1;
} finally {
  if (client) await client.query('ROLLBACK').catch(() => {});
  client?.release();
  await pool.end();
}
