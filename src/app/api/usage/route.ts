import { authorizeRequest } from "@/lib/auth-session";
import { getAssessmentUsage } from "@/lib/assessment-usage";
import { apiSuccess, apiError } from "@/lib/api-response";

export async function GET(request: Request) {
  const access = await authorizeRequest(request);
  if (access.response) return access.response;
  try { return apiSuccess({ usage: await getAssessmentUsage(access.user.id) }); }
  catch { return apiError("DATABASE_UNAVAILABLE"); }
}
