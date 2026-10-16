import "server-only";
import { db } from "@/lib/db";

// Owner-only usage stats. Read-only queries; nothing here is exposed through an API route.

const list = (value: string | undefined) => (value ?? "").split(",").map(item => item.trim().toLowerCase()).filter(Boolean);

// ADMIN_EMAILS: who may open /admin. Admins are also left out of the numbers.
export const adminEmails = () => list(process.env.ADMIN_EMAILS);
export const isAdmin = (email: string | null | undefined) => !!email && adminEmails().includes(email.toLowerCase());

// Test and demo accounts never count as real users. STATS_EXCLUDE_EMAILS adds more (exact emails or "@domain").
const TEST_PATTERNS = ["%@example.com", "scopecheck-qa-%", "browser-qa-%", "%@northwind-demo.dev"];
function exclusions() {
  const extra = list(process.env.STATS_EXCLUDE_EMAILS);
  return {
    emails: [...adminEmails(), ...extra.filter(item => !item.startsWith("@"))],
    patterns: [...TEST_PATTERNS, ...extra.filter(item => item.startsWith("@")).map(domain => `%${domain}`)],
  };
}
// $1 = excluded emails, $2 = excluded LIKE patterns
const REAL_USER = `NOT (lower(u.email) = ANY($1::text[]) OR lower(u.email) LIKE ANY($2::text[]))`;

export type StageKey = "signed_up" | "verified" | "project" | "request" | "ai_check" | "decision";
export const STAGES: { key: StageKey; label: string }[] = [
  { key: "signed_up", label: "Signed up" },
  { key: "verified", label: "Verified email" },
  { key: "project", label: "Created a project" },
  { key: "request", label: "Added a request" },
  { key: "ai_check", label: "Ran an AI check" },
  { key: "decision", label: "Saved a decision" },
];

export type UserRow = {
  id: string; name: string; email: string; verified: boolean; method: string; joinedAt: Date; lastActiveAt: Date | null;
  projects: number; requests: number; aiChecks: number; decisions: number; documents: number; changeOrders: number; replies: number;
};

export function furthestStage(user: UserRow): StageKey {
  if (user.decisions > 0) return "decision";
  if (user.aiChecks > 0) return "ai_check";
  if (user.requests > 0) return "request";
  if (user.projects > 0) return "project";
  return user.verified ? "verified" : "signed_up";
}

export async function getAdminStats() {
  const { emails, patterns } = exclusions();
  const params = [emails, patterns];
  const [users, daily, today] = await Promise.all([
    db.query<UserRow>(
      `SELECT u.id, u.name, u.email, u."emailVerified" AS verified, u."createdAt" AS "joinedAt",
         COALESCE((SELECT string_agg(DISTINCT CASE a."providerId" WHEN 'credential' THEN 'Email' WHEN 'google' THEN 'Google' ELSE a."providerId" END, ' + ')
                   FROM auth_account a WHERE a."userId" = u.id), '—') AS method,
         (SELECT max(s."updatedAt") FROM auth_session s WHERE s."userId" = u.id) AS "lastActiveAt",
         (SELECT count(*)::int FROM projects p WHERE p.owner_user_id = u.id) AS projects,
         (SELECT count(*)::int FROM requests r JOIN projects p ON p.id = r.project_id WHERE p.owner_user_id = u.id) AS requests,
         (SELECT count(*)::int FROM assessments a JOIN requests r ON r.id = a.request_id JOIN projects p ON p.id = r.project_id WHERE p.owner_user_id = u.id) AS "aiChecks",
         (SELECT count(*)::int FROM requests r JOIN projects p ON p.id = r.project_id WHERE p.owner_user_id = u.id AND r.decision IS NOT NULL) AS decisions,
         (SELECT count(*)::int FROM project_documents d JOIN projects p ON p.id = d.project_id WHERE p.owner_user_id = u.id) AS documents,
         (SELECT count(*)::int FROM change_orders c JOIN projects p ON p.id = c.project_id WHERE p.owner_user_id = u.id) AS "changeOrders",
         (SELECT count(*)::int FROM reply_drafts d JOIN requests r ON r.id = d.request_id JOIN projects p ON p.id = r.project_id WHERE p.owner_user_id = u.id) AS replies
       FROM auth_user u WHERE ${REAL_USER}
       ORDER BY u."createdAt" DESC LIMIT 500`, params),
    db.query<{ day: string; signups: number }>(
      `SELECT to_char(d.day, 'YYYY-MM-DD') AS day, count(u.id)::int AS signups
       FROM generate_series((now() AT TIME ZONE 'UTC')::date - 29, (now() AT TIME ZONE 'UTC')::date, interval '1 day') AS d(day)
       LEFT JOIN auth_user u ON (u."createdAt" AT TIME ZONE 'UTC')::date = d.day AND ${REAL_USER}
       GROUP BY d.day ORDER BY d.day`, params),
    db.query<{ aiAttempts: number; embeddingTokens: number }>(
      `SELECT
         COALESCE((SELECT sum(x.used)::int FROM assessment_usage x JOIN auth_user u ON u.id = x.user_id
                   WHERE x.usage_day = (statement_timestamp() AT TIME ZONE 'UTC')::date AND ${REAL_USER}), 0) AS "aiAttempts",
         COALESCE((SELECT sum(x.tokens)::int FROM embedding_usage x JOIN auth_user u ON u.id = x.user_id
                   WHERE x.usage_day = (statement_timestamp() AT TIME ZONE 'UTC')::date AND ${REAL_USER}), 0) AS "embeddingTokens"`, params),
  ]);

  const rows = users.rows;
  const now = Date.now();
  const since = (days: number) => rows.filter(user => now - user.joinedAt.getTime() <= days * 86_400_000).length;
  const reached = (key: StageKey) => {
    const order = STAGES.findIndex(stage => stage.key === key);
    return rows.filter(user => STAGES.findIndex(stage => stage.key === furthestStage(user)) >= order).length;
  };
  return {
    users: rows,
    totals: {
      users: rows.length, last7: since(7), last30: since(30),
      activeLast7: rows.filter(user => user.lastActiveAt && now - user.lastActiveAt.getTime() <= 7 * 86_400_000).length,
      documents: rows.reduce((sum, user) => sum + user.documents, 0),
      aiChecks: rows.reduce((sum, user) => sum + user.aiChecks, 0),
    },
    funnel: STAGES.map(stage => ({ ...stage, count: reached(stage.key) })),
    daily: daily.rows,
    today: today.rows[0],
    excludedCount: emails.length + patterns.length,
  };
}
