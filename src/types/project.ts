// JSON contract shared by API handlers and frontend consumers.
export type ProjectDto = {
  id: string;
  name: string;
  clientName: string | null;
  scope: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateProjectData = { project: ProjectDto };
export type ListProjectsData = { projects: ProjectDto[] };
export type UpdateProjectData = { project: ProjectDto };
export type DeleteProjectData = { id: string };
