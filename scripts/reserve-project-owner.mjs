import nextEnv from '@next/env';
import { Pool } from 'pg';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';

const input = z.object({ projectId: z.string().uuid(), email: z.string().email().transform(value => value.toLowerCase()) }).parse({ projectId: process.argv[2], email: process.argv[3] });
nextEnv.loadEnvConfig(fileURLToPath(new URL('../', import.meta.url)));
const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
try {
  const result = await pool.query(
    `UPDATE projects SET legacy_owner_email = $2 WHERE id = $1 AND owner_user_id IS NULL
     AND (legacy_owner_email IS NULL OR legacy_owner_email = $2) RETURNING id`,
    [input.projectId, input.email],
  );
  if (!result.rowCount) throw new Error('Project missing, already owned, or reserved to another account.');
  console.log('Project reserved. A verified matching account will receive ownership on sign-in.');
} finally { await pool.end(); }
