import { authorizeRequest } from "@/lib/auth-session";
import { db, withTransaction } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/api-response";
import { updateProjectSchema } from "@/schemas/project";
import { projectIdSchema } from "@/schemas/request";
import type { DeleteProjectData, ProjectDto, UpdateProjectData } from "@/types/project";

type Params = { params: Promise<{ projectId: string }> };
type ProjectRow = Omit<ProjectDto, "createdAt" | "updatedAt"> & { createdAt: Date; updatedAt: Date };

async function parseProjectId(params: Params["params"]) {
  const parsed = projectIdSchema.safeParse((await params).projectId);
  return parsed.success ? parsed.data : null;
}

export async function PATCH(request: Request, { params }: Params) {
  const access = await authorizeRequest(request);
  if (access.response) return access.response;
  const projectId = await parseProjectId(params);
  if (!projectId) return apiError("VALIDATION_ERROR", [{ field: "projectId", message: "Invalid project ID" }]);
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("INVALID_JSON"); }
  const parsed = updateProjectSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", parsed.error.issues.map(issue => ({ field: issue.path.join("."), message: issue.message })));
  }
  const { name, clientName, scope } = parsed.data;
  try {
    // Saved assessments keep their scope snapshot, so a scope change marks them stale automatically.
    const result = await db.query<ProjectRow>(
      `UPDATE projects SET name = $1, client_name = $2, scope = $3, updated_at = NOW()
       WHERE id = $4 AND owner_user_id = $5
       RETURNING id, name, client_name AS "clientName", scope, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [name, clientName || null, scope, projectId, access.user.id],
    );
    const row = result.rows[0];
    if (!row) return apiError("NOT_FOUND");
    return apiSuccess<UpdateProjectData>({ project: { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() } });
  } catch {
    console.error("Failed to update project.");
    return apiError("INTERNAL_ERROR");
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const access = await authorizeRequest(request);
  if (access.response) return access.response;
  const projectId = await parseProjectId(params);
  if (!projectId) return apiError("VALIDATION_ERROR", [{ field: "projectId", message: "Invalid project ID" }]);
  try {
    const deleted = await withTransaction(async client => {
      // Lock the project and its requests first: a concurrent request insert or assessment save
      // waits on these locks and then fails cleanly instead of leaving orphaned rows.
      const owned = await client.query("SELECT id FROM projects WHERE id = $1 AND owner_user_id = $2 FOR UPDATE", [projectId, access.user.id]);
      if (!owned.rowCount) return false;
      await client.query("SELECT id FROM requests WHERE project_id = $1 FOR UPDATE", [projectId]);
      await client.query("DELETE FROM assessments WHERE request_id IN (SELECT id FROM requests WHERE project_id = $1)", [projectId]);
      await client.query("DELETE FROM requests WHERE project_id = $1", [projectId]);
      await client.query("DELETE FROM projects WHERE id = $1", [projectId]);
      return true;
    });
    if (!deleted) return apiError("NOT_FOUND");
    return apiSuccess<DeleteProjectData>({ id: projectId });
  } catch {
    console.error("Failed to delete project.");
    return apiError("INTERNAL_ERROR");
  }
}
