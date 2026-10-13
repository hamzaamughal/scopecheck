import { authorizeRequest } from "@/lib/auth-session";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/api-response";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const access = await authorizeRequest(request);
  if (access.response) return access.response;
  try {
    const result = await db.query<{ now: Date }>("SELECT NOW() AS now");
    return apiSuccess({ connected: true, databaseTime: result.rows[0].now.toISOString() });
  } catch {
    console.error("Database connection check failed.");
    return apiError("DATABASE_UNAVAILABLE");
  }
}
