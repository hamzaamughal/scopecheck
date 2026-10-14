import type { Project } from "@/lib/demo-data";
import type { ProjectDto } from "@/types/project";

// Presentation-only values are derived from saved data, never written to the DB.
export function toProjectView(project: ProjectDto): Project {
  const initials = project.name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join("").toUpperCase();
  return {
    id: project.id,
    name: project.name,
    client: project.clientName || "Independent project",
    clientName: project.clientName, // Raw value for edit forms.
    source: project.source,
    initials,
    color: "purple",
    description: project.scope.replace(/^\[Page \d+\]$/gm, "").replace(/\s+/g, " ").trim(),
    scope: project.scope,
    requests: [], // Populated from the request API when loading an existing project.
  };
}
