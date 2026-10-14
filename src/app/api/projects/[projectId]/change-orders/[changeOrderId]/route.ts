import { z } from "zod";
import { authorizeRequest } from "@/lib/auth-session";
import { withTransaction } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/api-response";
import { fieldErrors } from "@/lib/route-helpers";
import { getProject } from "@/lib/project-repository";
import { CHANGE_ORDER_COLUMNS, changeOrderAddendum, recordScopeVersion, toChangeOrderDto } from "@/lib/workflow-repository";
import { changeOrderActionSchema, changeOrderInputSchema } from "@/schemas/workflow";
import { SCOPE_MAX_CHARS } from "@/lib/scope-import/normalize";
import type { AcceptChangeOrderData, ChangeOrderData, ChangeOrderDto } from "@/types/workflow";
import type { ProjectDto } from "@/types/project";

type Params = { params: Promise<{ projectId: string; changeOrderId: string }> };
const paramsSchema = z.object({ projectId: z.string().uuid("Invalid project ID"), changeOrderId: z.string().uuid("Invalid change order ID") });

// Owned change order, locked for the rest of the transaction. Locks the project first (same order everywhere).
async function lockOwned(client: import("pg").PoolClient, userId: string, projectId: string, changeOrderId: string) {
  const project = await client.query("SELECT scope FROM projects WHERE id = $1 AND owner_user_id = $2 FOR UPDATE", [projectId, userId]);
  if (!project.rowCount) return undefined;
  const order = await client.query(`SELECT ${CHANGE_ORDER_COLUMNS} FROM change_orders c WHERE c.id = $1 AND c.project_id = $2 FOR UPDATE`, [changeOrderId, projectId]);
  return order.rows[0] ? { scope: project.rows[0].scope as string, order: toChangeOrderDto(order.rows[0]) } : undefined;
}

// Body is either { action: "accept" | "reject" } or editable fields (only while proposed).
export async function PATCH(request: Request, { params }: Params) {
  const access = await authorizeRequest(request);
  if (access.response) return access.response;
  const ids = paramsSchema.safeParse(await params);
  if (!ids.success) return apiError("VALIDATION_ERROR", fieldErrors(ids.error));
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("INVALID_JSON"); }
  const isAction = typeof body === "object" && body !== null && "action" in body;
  const action = isAction ? changeOrderActionSchema.safeParse(body) : undefined;
  const edit = isAction ? undefined : changeOrderInputSchema.omit({ requestId: true }).safeParse(body);
  if (action && !action.success) return apiError("VALIDATION_ERROR", fieldErrors(action.error));
  if (edit && !edit.success) return apiError("VALIDATION_ERROR", fieldErrors(edit.error));
  const { projectId, changeOrderId } = ids.data;

  try {
    type Outcome = { error: "NOT_FOUND" | "CONFLICT" | "SCOPE_TOO_LONG" } | { changeOrder: ChangeOrderDto; project?: ProjectDto };
    const outcome = await withTransaction(async (client): Promise<Outcome> => {
      const owned = await lockOwned(client, access.user.id, projectId, changeOrderId);
      if (!owned) return { error: "NOT_FOUND" as const };
      if (owned.order.status !== "proposed") return { error: "CONFLICT" as const };

      if (edit?.success) {
        const input = edit.data;
        const result = await client.query(
          `UPDATE change_orders c SET title = $3, description = $4, hours = $5, amount_cents = $6, currency = $7, updated_at = NOW()
           WHERE c.id = $1 AND c.project_id = $2 RETURNING ${CHANGE_ORDER_COLUMNS}`,
          [changeOrderId, projectId, input.title, input.description, input.hours ?? null, input.amount === undefined ? null : Math.round(input.amount * 100), input.currency]);
        return { changeOrder: toChangeOrderDto(result.rows[0]) };
      }

      const accept = action?.success && action.data.action === "accept";
      const decidedAt = new Date();
      if (accept) {
        // Accepted extra work becomes part of the agreed scope, as a new scope version.
        const scope = `${owned.scope.trimEnd()}\n\n${changeOrderAddendum(owned.order, decidedAt)}`;
        if (scope.length > SCOPE_MAX_CHARS) return { error: "SCOPE_TOO_LONG" as const };
        await client.query("UPDATE projects SET scope = $2, updated_at = NOW() WHERE id = $1", [projectId, scope]);
        await recordScopeVersion(client, projectId, "change_order", changeOrderId);
      }
      const result = await client.query(
        `UPDATE change_orders c SET status = $3, decided_at = $4, updated_at = NOW() WHERE c.id = $1 AND c.project_id = $2 RETURNING ${CHANGE_ORDER_COLUMNS}`,
        [changeOrderId, projectId, accept ? "accepted" : "rejected", decidedAt]);
      return { changeOrder: toChangeOrderDto(result.rows[0]), project: accept ? await getProject(client, access.user.id, projectId) : undefined };
    });
    if ("error" in outcome) return apiError(outcome.error);
    return outcome.project
      ? apiSuccess<AcceptChangeOrderData>({ changeOrder: outcome.changeOrder, project: outcome.project })
      : apiSuccess<ChangeOrderData>({ changeOrder: outcome.changeOrder });
  } catch {
    console.error("Failed to update change order.");
    return apiError("INTERNAL_ERROR");
  }
}

// Proposed or rejected change orders can be deleted. Accepted ones are part of the scope history.
export async function DELETE(request: Request, { params }: Params) {
  const access = await authorizeRequest(request);
  if (access.response) return access.response;
  const ids = paramsSchema.safeParse(await params);
  if (!ids.success) return apiError("VALIDATION_ERROR", fieldErrors(ids.error));
  const { projectId, changeOrderId } = ids.data;
  try {
    const outcome = await withTransaction(async client => {
      const owned = await lockOwned(client, access.user.id, projectId, changeOrderId);
      if (!owned) return "NOT_FOUND" as const;
      if (owned.order.status === "accepted") return "CONFLICT" as const;
      await client.query("DELETE FROM change_orders WHERE id = $1", [changeOrderId]);
      return "OK" as const;
    });
    return outcome === "OK" ? apiSuccess({ id: changeOrderId }) : apiError(outcome);
  } catch {
    console.error("Failed to delete change order.");
    return apiError("INTERNAL_ERROR");
  }
}
