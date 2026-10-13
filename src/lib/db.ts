import "server-only";
import { Pool, type PoolClient } from "pg";
import { attachDatabasePool } from "@vercel/functions";

const globalForDb = globalThis as typeof globalThis & {
  scopecheckPool?: Pool;
};

function createPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing");
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    // Short idle timeout so suspended serverless instances do not hold connections open.
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
  });

  pool.on("error", () => {
    console.error("An idle database connection failed.");
  });

  // On Vercel Fluid compute, closes idle clients before the instance suspends. No-op elsewhere.
  attachDatabasePool(pool);
  return pool;
}

// Development hot reloads should reuse the existing connection pool.
export const db = globalForDb.scopecheckPool ?? createPool();

if (process.env.NODE_ENV !== "production") {
  globalForDb.scopecheckPool = db;
}
// Runs fn inside one transaction on a dedicated connection; rolls back on any error.
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
