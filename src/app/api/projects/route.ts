import { authorizeRequest } from "@/lib/auth-session";
import { withTransaction } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/api-response";
import { getProject, listProjects, saveScopeSource } from "@/lib/project-repository";
import { createProjectSchema } from "@/schemas/project";
import type { CreateProjectData, ListProjectsData } from "@/types/project";

export async function POST(request: Request) {
  const access = await authorizeRequest(request);
  if (access.response) return access.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON");
  }

  const parsed = createProjectSchema.safeParse(body);
  if (!parsed.success) {
    const details = parsed.error.issues.map(issue => ({ field: issue.path.join("."), message: issue.message }));
    return apiError("VALIDATION_ERROR", details);
  }

  const { name, clientName, scope, source } = parsed.data;
  try {
    // Project and its import source are written together or not at all.
    const project = await withTransaction(async client => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO projects (name, client_name, scope, owner_user_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [name, clientName || null, scope, access.user.id],
      );
      await saveScopeSource(client, inserted.rows[0].id, source);
      return getProject(client, access.user.id, inserted.rows[0].id);
    });
    if (!project) return apiError("INTERNAL_ERROR");
    return apiSuccess<CreateProjectData>({ project }, 201);
  } catch {
    console.error("Failed to create project.");
    return apiError("INTERNAL_ERROR");
  }
}

export async function GET(request: Request) {
  const access = await authorizeRequest(request);
  if (access.response) return access.response;
  try {
    return apiSuccess<ListProjectsData>({ projects: await listProjects(access.user.id) });
  } catch {
    console.error("Failed to fetch projects.");
    return apiError("INTERNAL_ERROR");
  }
}
