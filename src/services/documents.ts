import { apiRequest } from "@/lib/api-client";
import type { DocumentInput } from "@/schemas/documents";
import type { DocumentData, DocumentTextData, ListDocumentsData } from "@/types/documents";

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/documents`;

export const listDocuments = (projectId: string, signal?: AbortSignal) => apiRequest<ListDocumentsData>(base(projectId), { signal });
export const createDocument = (projectId: string, input: DocumentInput) =>
  apiRequest<DocumentData>(base(projectId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
export const getDocument = (projectId: string, id: string, signal?: AbortSignal) => apiRequest<DocumentTextData>(`${base(projectId)}/${encodeURIComponent(id)}`, { signal });
export const deleteDocument = (projectId: string, id: string) => apiRequest<{ id: string }>(`${base(projectId)}/${encodeURIComponent(id)}`, { method: "DELETE" });
