import "server-only";
import { db } from "@/lib/db";
import type { AssessmentUsage } from "@/types/usage";

export function dailyAssessmentLimit() {
  const limit = Number(process.env.ASSESSMENT_DAILY_LIMIT ?? "10");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000) {
    throw new Error("ASSESSMENT_DAILY_LIMIT must be an integer between 1 and 10000");
  }
  return limit;
}

// The conflict row is locked by PostgreSQL; concurrent requests cannot exceed the allowance.
// Reserve before calling AI. Failed/abandoned attempts remain counted to bound provider spend.
export async function reserveAssessment(userId: string): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO assessment_usage (user_id, usage_day, used)
     VALUES ($1, (statement_timestamp() AT TIME ZONE 'UTC')::date, 1)
     ON CONFLICT (user_id, usage_day) DO UPDATE SET used = assessment_usage.used + 1
     WHERE assessment_usage.used < $2 RETURNING used`,
    [userId, dailyAssessmentLimit()],
  );
  return result.rows.length === 1;
}

export async function getAssessmentUsage(userId: string): Promise<AssessmentUsage> {
  const limit = dailyAssessmentLimit();
  const result = await db.query<{ used: number; resets_at: Date }>(
    `SELECT COALESCE(u.used, 0)::int AS used,
       ((d.day + 1)::timestamp AT TIME ZONE 'UTC') AS resets_at
     FROM (SELECT (statement_timestamp() AT TIME ZONE 'UTC')::date AS day) d
     LEFT JOIN assessment_usage u ON u.usage_day = d.day AND u.user_id = $1`, [userId],
  );
  const row = result.rows[0];
  return { limit, used: row.used, remaining: Math.max(0, limit - row.used), resetsAt: row.resets_at.toISOString() };
}
