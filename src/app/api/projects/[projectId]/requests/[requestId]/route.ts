import { authorizeRequest } from "@/lib/auth-session";
import { z } from "zod";
import { db, withTransaction } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/api-response";
import { toRequestDto, type RequestRow } from "@/lib/request-mapper";
import { updateDecisionSchema, updateRequestContentSchema } from "@/schemas/request";
import type { DeleteRequestData, UpdateDecisionData } from "@/types/request";
import type { FieldError } from "@/types/api";

type Params = { params: Promise<{ projectId: string; requestId: string }> };

const paramsSchema = z.object({
  projectId: z.string().uuid("Invalid project ID"),
  requestId: z.string().uuid("Invalid request ID"),
});

const RETURNING = `RETURNING id, project_id AS "projectId", title, description,
  decision, decision_note AS "decisionNote", decided_at AS "decidedAt",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

// Both IDs and the owner must match, so a request cannot be changed under another project or account.
const OWNED = `id = $1 AND project_id = $2
  AND EXISTS (SELECT 1 FROM projects p WHERE p.id = requests.project_id AND p.owner_user_id = $3)`;

const toFieldErrors = (error: z.ZodError): FieldError[] => error.issues.map(issue => ({ field: issue.path.join("."), message: issue.message }));

// One PATCH endpoint, two shapes: { decision, decisionNote } records the human decision;
// { title, description } edits the request wording. Mixed bodies are rejected.
export async function PATCH(request: Request, { params }: Params) {
  const access = await authorizeRequest(request);
  if (access.response) return access.response;
  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) return apiError("VALIDATION_ERROR", toFieldErrors(parsedParams.error));
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("INVALID_JSON"); }
  const { projectId, requestId } = parsedParams.data;

  const fields = typeof body === "object" && body !== null ? Object.keys(body) : [];
  const hasDecision = fields.includes("decision");
  const hasContent = fields.includes("title") || fields.includes("description");
  if (hasDecision === hasContent) {
    return apiError("VALIDATION_ERROR", [{ field: "body", message: "Send either a decision or a title and description." }]);
  }

  try {
    let result;
    if (hasDecision) {
      const parsed = updateDecisionSchema.safeParse(body);
      if (!parsed.success) return apiError("VALIDATION_ERROR", toFieldErrors(parsed.error));
      result = await db.query<RequestRow>(
        `UPDATE requests SET decision = $4, decision_note = $5, decided_at = NOW(), updated_at = NOW()
         WHERE ${OWNED} ${RETURNING}`,
        [requestId, projectId, access.user.id, parsed.data.decision, parsed.data.decisionNote || null],
      );
    } else {
      const parsed = updateRequestContentSchema.safeParse(body);
      if (!parsed.success) return apiError("VALIDATION_ERROR", toFieldErrors(parsed.error));
      // The human decision is kept; saved assessments become stale through their snapshots.
      result = await db.query<RequestRow>(
        `UPDATE requests SET title = $4, description = $5, updated_at = NOW()
         WHERE ${OWNED} ${RETURNING}`,
        [requestId, projectId, access.user.id, parsed.data.title, parsed.data.description],
      );
    }
    const row = result.rows[0];
    if (!row) return apiError("NOT_FOUND");
    return apiSuccess<UpdateDecisionData>({ request: toRequestDto(row) });
  } catch {
    console.error("Failed to update request.");
    return apiError("INTERNAL_ERROR");
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const access = await authorizeRequest(request);
  if (access.response) return access.response;
  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) return apiError("VALIDATION_ERROR", toFieldErrors(parsedParams.error));
  const { projectId, requestId } = parsedParams.data;
  try {
    const deleted = await withTransaction(async client => {
      // Row lock makes a concurrent assessment save wait, then fail, instead of orphaning a row.
      const owned = await client.query(`SELECT id FROM requests WHERE ${OWNED} FOR UPDATE`, [requestId, projectId, access.user.id]);
      if (!owned.rowCount) return false;
      await client.query("DELETE FROM assessments WHERE request_id = $1", [requestId]);
      await client.query("DELETE FROM requests WHERE id = $1", [requestId]);
      return true;
    });
    if (!deleted) return apiError("NOT_FOUND");
    return apiSuccess<DeleteRequestData>({ id: requestId });
  } catch {
    console.error("Failed to delete request.");
    return apiError("INTERNAL_ERROR");
  }
}
