import { apiRequest } from "@/lib/api-client";
import type { CreateRequestInput, UpdateDecisionInput, UpdateRequestContentInput } from "@/schemas/request";
import type { CreateRequestData, DeleteRequestData, ListRequestsData, UpdateDecisionData } from "@/types/request";

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const requestsUrl = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/requests`;
const requestUrl = (projectId: string, requestId: string) => `${requestsUrl(projectId)}/${encodeURIComponent(requestId)}`;

export function listRequests(projectId: string, signal?: AbortSignal) {
  return apiRequest<ListRequestsData>(requestsUrl(projectId), { signal });
}

export function createRequest(projectId: string, input: CreateRequestInput) {
  return apiRequest<CreateRequestData>(requestsUrl(projectId), json("POST", input));
}

export function updateDecision(projectId: string, requestId: string, input: UpdateDecisionInput) {
  return apiRequest<UpdateDecisionData>(requestUrl(projectId, requestId), json("PATCH", input));
}

export function updateRequestContent(projectId: string, requestId: string, input: UpdateRequestContentInput) {
  return apiRequest<UpdateDecisionData>(requestUrl(projectId, requestId), json("PATCH", input));
}

export function deleteRequest(projectId: string, requestId: string) {
  return apiRequest<DeleteRequestData>(requestUrl(projectId, requestId), { method: "DELETE" });
}
