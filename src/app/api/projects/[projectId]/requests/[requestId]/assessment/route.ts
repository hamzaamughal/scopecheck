import { authorizeRequest } from "@/lib/auth-session";
import { z } from "zod";
import { getAssessmentSource, getSavedAssessment, saveAssessment, type AssessmentSource } from "@/lib/assessment-repository";
import { apiError, apiSuccess } from "@/lib/api-response";
import { ASSESSMENT_MODEL, assessRequest } from "@/lib/ai/assess-request";
import type { AssessRequestData } from "@/types/assessment";
import type { Assessment } from "@/schemas/assessment";
import { reserveAssessment } from "@/lib/assessment-usage";

export const runtime = "nodejs";

const paramsSchema = z.object({
  projectId: z.string().uuid("Invalid project ID"),
  requestId: z.string().uuid("Invalid request ID"),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string; requestId: string }> }
) {
  const access = await authorizeRequest(request);
  if (access.response) return access.response;
  const parsed = paramsSchema.safeParse(await params);

  if (!parsed.success) {
    return apiError(
      "VALIDATION_ERROR",
      parsed.error.issues.map(issue => ({
        field: issue.path.join("."),
        message: issue.message,
      }))
    );
  }

  const { projectId, requestId } = parsed.data;
  let source: AssessmentSource | undefined;

  try {
    source = await getAssessmentSource(access.user.id, projectId, requestId);
  } catch {
    console.error("Failed to load assessment source.");
    return apiError("INTERNAL_ERROR");
  }

  if (!source) return apiError("NOT_FOUND");

  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is missing.");
    return apiError("INTERNAL_ERROR");
  }

  try {
    if (!await reserveAssessment(access.user.id)) return apiError("ASSESSMENT_LIMIT_REACHED");
  } catch {
    console.error("Could not reserve assessment allowance.");
    return apiError("DATABASE_UNAVAILABLE");
  }

  let assessment: Assessment;
  try {
    assessment = await assessRequest({
      scope: source.scope,
      title: source.title,
      description: source.description,
    });

  } catch (error) {
    console.error("Assessment failed.", {
      requestId,
      errorType: error instanceof Error ? error.name : "UnknownError",
    });

    return apiError("ASSESSMENT_FAILED");
  }

  try {
    const id = await saveAssessment(access.user.id, projectId, source, ASSESSMENT_MODEL, assessment);
    const saved = await getSavedAssessment(access.user.id, projectId, requestId, id);
    if (!saved?.assessment) throw new Error("Saved assessment unavailable");
    return apiSuccess<AssessRequestData>({ requestId, assessment: saved.assessment }, 201);
  } catch {
    console.error("Failed to confirm assessment persistence.");
    return apiError("ASSESSMENT_SAVE_FAILED");
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string; requestId: string }> },
) {
  const access = await authorizeRequest(request);
  if (access.response) return access.response;
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues.map(issue => ({
    field: issue.path.join("."), message: issue.message,
  })));
  try {
    const saved = await getSavedAssessment(access.user.id, parsed.data.projectId, parsed.data.requestId);
    return saved ? apiSuccess(saved) : apiError("NOT_FOUND");
  } catch {
    console.error("Failed to load saved assessment.");
    return apiError("DATABASE_UNAVAILABLE");
  }
}
