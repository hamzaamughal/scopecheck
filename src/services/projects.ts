import { apiRequest } from "@/lib/api-client";
import type { CreateProjectInput, UpdateProjectInput } from "@/schemas/project";
import type { CreateProjectData, DeleteProjectData, ListProjectsData, UpdateProjectData } from "@/types/project";

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const projectUrl = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}`;

export function listProjects(signal?: AbortSignal) {
  return apiRequest<ListProjectsData>("/api/projects", { signal });
}

export function createProject(input: CreateProjectInput) {
  return apiRequest<CreateProjectData>("/api/projects", json("POST", input));
}

export function updateProject(projectId: string, input: UpdateProjectInput) {
  return apiRequest<UpdateProjectData>(projectUrl(projectId), json("PATCH", input));
}

export function deleteProject(projectId: string) {
  return apiRequest<DeleteProjectData>(projectUrl(projectId), { method: "DELETE" });
}
