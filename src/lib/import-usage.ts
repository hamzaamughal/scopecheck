import "server-only";
import { db } from "@/lib/db";

export const DAILY_LINK_IMPORTS = 30;

// Same atomic pattern as assessment usage: the conflict row is locked, so the limit cannot be exceeded.
export async function reserveLinkImport(userId: string): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO import_usage (user_id, usage_day, used)
     VALUES ($1, (statement_timestamp() AT TIME ZONE 'UTC')::date, 1)
     ON CONFLICT (user_id, usage_day) DO UPDATE SET used = import_usage.used + 1
     WHERE import_usage.used < $2 RETURNING used`,
    [userId, DAILY_LINK_IMPORTS],
  );
  return result.rows.length === 1;
}
