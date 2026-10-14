// JSON contract shared by API handlers and frontend consumers.
export type ScopeSourceDto = {
  kind: "file" | "link";
  label: string;
  sourceUrl: string | null;
  pageCount: number | null;
  importedAt: string;
  lastCheckedAt: string | null;
  editedSinceImport: boolean;
};

export type ProjectDto = {
  id: string;
  name: string;
  clientName: string | null;
  scope: string;
  createdAt: string;
  updatedAt: string;
  source: ScopeSourceDto | null;
};

export type CreateProjectData = { project: ProjectDto };
export type ListProjectsData = { projects: ProjectDto[] };
export type UpdateProjectData = { project: ProjectDto };
export type DeleteProjectData = { id: string };
export type ImportLinkData = { text: string; title: string; label: string; sourceUrl: string; finalUrl: string; contentHash: string; fetchedAt: string; hint?: string };
