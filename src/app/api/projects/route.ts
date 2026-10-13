import { authorizeRequest } from "@/lib/auth-session";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/api-response";
import { createProjectSchema } from "@/schemas/project";
import type { CreateProjectData, ProjectDto } from "@/types/project";

type ProjectRow = Omit<ProjectDto, "createdAt" | "updatedAt"> & {
  createdAt: Date;
  updatedAt: Date;
};

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

  const { name, clientName, scope } = parsed.data;
  try {
    const result = await db.query<ProjectRow>(
      `INSERT INTO projects (name, client_name, scope, owner_user_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, client_name AS "clientName", scope,
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [name, clientName || null, scope, access.user.id]
    );
    const row = result.rows[0];
    // pg returns Dates; the API contract exposes ISO strings to frontend consumers.
    const project: ProjectDto = { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
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
    const result = await db.query<ProjectRow>(
      `SELECT id, name, client_name AS "clientName", scope,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM projects WHERE owner_user_id = $1
       ORDER BY created_at DESC, id DESC`, [access.user.id]
    );

    const projects: ProjectDto[] = result.rows.map(row => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));

    return apiSuccess({ projects });
  } catch {
    console.error("Failed to fetch projects.");
    return apiError("INTERNAL_ERROR");
  }
}