import { authorizeRequest } from "@/lib/auth-session";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/api-response";
import { createRequestSchema, projectIdSchema } from "@/schemas/request";
import type { CreateRequestData, ListRequestsData } from "@/types/request";

import { toRequestDto, type RequestRow } from "@/lib/request-mapper";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const access = await authorizeRequest(request);
  if (access.response) return access.response;
  const { projectId } = await params;
  const validId = projectIdSchema.safeParse(projectId);

  if (!validId.success) {
    return apiError("VALIDATION_ERROR", [
      { field: "projectId", message: "Invalid project ID" },
    ]);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON");
  }

  const parsed = createRequestSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      "VALIDATION_ERROR",
      parsed.error.issues.map(issue => ({
        field: issue.path.join("."),
        message: issue.message,
      }))
    );
  }

  const { title, description } = parsed.data;

  try {
    const result = await db.query<RequestRow>(
      `INSERT INTO requests (project_id, title, description)
       SELECT id, $2, $3 FROM projects WHERE id = $1 AND owner_user_id = $4
       RETURNING id, project_id AS "projectId", title, description,
                 decision, decision_note AS "decisionNote",
                 decided_at AS "decidedAt", created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      [validId.data, title, description, access.user.id]
    );

    const row = result.rows[0];
    if (!row) return apiError("NOT_FOUND");

    const savedRequest = toRequestDto(row);

    return apiSuccess<CreateRequestData>({ request: savedRequest }, 201);
  } catch {
    console.error("Failed to create request.");
    return apiError("INTERNAL_ERROR");
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const access = await authorizeRequest(request);
  if (access.response) return access.response;
  const { projectId } = await params;
  const validId = projectIdSchema.safeParse(projectId);

  if (!validId.success) {
    return apiError("VALIDATION_ERROR", [
      { field: "projectId", message: "Invalid project ID" },
    ]);
  }

  try {
    const project = await db.query<{ id: string }>(
      "SELECT id FROM projects WHERE id = $1 AND owner_user_id = $2",
      [validId.data, access.user.id]
    );

    if (!project.rows.length) return apiError("NOT_FOUND");

    const result = await db.query<RequestRow>(
      `SELECT id, project_id AS "projectId", title, description,
              decision, decision_note AS "decisionNote",
              decided_at AS "decidedAt", created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM requests
       WHERE project_id = $1 AND EXISTS (SELECT 1 FROM projects p WHERE p.id = requests.project_id AND p.owner_user_id = $2)
       ORDER BY created_at DESC, id DESC`,
      [validId.data, access.user.id]
    );

    return apiSuccess<ListRequestsData>({
      requests: result.rows.map(toRequestDto),
    });
  } catch {
    console.error("Failed to fetch project requests.");
    return apiError("INTERNAL_ERROR");
  }
}