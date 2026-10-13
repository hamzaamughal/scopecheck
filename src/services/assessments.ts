import { apiRequest, ApiClientError } from "@/lib/api-client";
import { savedAssessmentSchema } from "@/schemas/assessment";
import type { AssessRequestData, GetAssessmentData } from "@/types/assessment";

export async function generateAssessment(projectId: string, requestId: string, signal?: AbortSignal) {
  const data = await apiRequest<AssessRequestData>(
    `/api/projects/${encodeURIComponent(projectId)}/requests/${encodeURIComponent(requestId)}/assessment`,
    { method: "POST", signal },
  );
  const parsed = savedAssessmentSchema.safeParse(data?.assessment);
  if (data?.requestId !== requestId || !parsed.success) {
    throw new ApiClientError("The server returned an unexpected assessment. Please try again.", "INVALID_RESPONSE");
  }
  return parsed.data;
}

export async function loadAssessment(projectId: string, requestId: string, signal?: AbortSignal) {
  const data = await apiRequest<GetAssessmentData>(
    `/api/projects/${encodeURIComponent(projectId)}/requests/${encodeURIComponent(requestId)}/assessment`,
    { signal },
  );
  const parsed = savedAssessmentSchema.nullable().safeParse(data?.assessment);
  if (data?.requestId !== requestId || !parsed.success) {
    throw new ApiClientError("The server returned an unexpected assessment. Please try again.", "INVALID_RESPONSE");
  }
  return parsed.data;
}
