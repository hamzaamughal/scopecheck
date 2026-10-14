import { apiRequest } from "@/lib/api-client";
import type { ChangeOrderInput } from "@/schemas/workflow";
import type { AcceptChangeOrderData, ChangeOrderData, ListChangeOrdersData, ListScopeVersionsData, ReplyDraftData, ScopeVersionData } from "@/types/workflow";

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}`;
const orderUrl = (projectId: string, id: string) => `${base(projectId)}/change-orders/${encodeURIComponent(id)}`;

export const listChangeOrders = (projectId: string, signal?: AbortSignal) => apiRequest<ListChangeOrdersData>(`${base(projectId)}/change-orders`, { signal });
export const createChangeOrder = (projectId: string, input: ChangeOrderInput) => apiRequest<ChangeOrderData>(`${base(projectId)}/change-orders`, json("POST", input));
export const editChangeOrder = (projectId: string, id: string, input: Omit<ChangeOrderInput, "requestId">) => apiRequest<ChangeOrderData>(orderUrl(projectId, id), json("PATCH", input));
export const acceptChangeOrder = (projectId: string, id: string) => apiRequest<AcceptChangeOrderData>(orderUrl(projectId, id), json("PATCH", { action: "accept" }));
export const rejectChangeOrder = (projectId: string, id: string) => apiRequest<ChangeOrderData>(orderUrl(projectId, id), json("PATCH", { action: "reject" }));
export const deleteChangeOrder = (projectId: string, id: string) => apiRequest<{ id: string }>(orderUrl(projectId, id), { method: "DELETE" });

export const listScopeVersions = (projectId: string, signal?: AbortSignal) => apiRequest<ListScopeVersionsData>(`${base(projectId)}/scope-versions`, { signal });
export const getScopeVersion = (projectId: string, version: number, signal?: AbortSignal) => apiRequest<ScopeVersionData>(`${base(projectId)}/scope-versions?version=${version}`, { signal });

export const getReplyDraft = (projectId: string, requestId: string, signal?: AbortSignal) => apiRequest<ReplyDraftData>(`${base(projectId)}/replies?requestId=${encodeURIComponent(requestId)}`, { signal });
export const generateReplyDraft = (projectId: string, requestId: string, tone: "friendly" | "formal") => apiRequest<ReplyDraftData>(`${base(projectId)}/replies`, json("POST", { requestId, tone }));
