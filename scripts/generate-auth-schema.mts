import nextEnv from "@next/env";
import { Pool } from "pg";
import { getMigrations } from "better-auth/db/migration";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createAuthOptions } from "../src/lib/auth-options.ts";

nextEnv.loadEnvConfig(fileURLToPath(new URL("../", import.meta.url)));
const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
try {
  const plan = await getMigrations(createAuthOptions(pool));
  const sql = await plan.compileMigrations();
  if (!sql.trim()) throw new Error("No auth schema changes to generate.");
  await writeFile(new URL("../db/migrations/003_auth.sql", import.meta.url), sql, { flag: "wx" });
  console.log("Generated 003_auth.sql; no database changes applied.");
} finally {
  await pool.end();
}
