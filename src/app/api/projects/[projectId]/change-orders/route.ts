import { authorizeRequest } from "@/lib/auth-session";
import { withTransaction } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/api-response";
import { parseBody } from "@/lib/route-helpers";
import { CHANGE_ORDER_COLUMNS, listChangeOrders, toChangeOrderDto } from "@/lib/workflow-repository";
import { changeOrderInputSchema } from "@/schemas/workflow";
import { projectIdSchema } from "@/schemas/request";
import type { ChangeOrderData, ListChangeOrdersData } from "@/types/workflow";

type Params = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, { params }: Params) {
  const access = await authorizeRequest(request);
  if (access.response) return access.response;
  const projectId = projectIdSchema.safeParse((await params).projectId);
  if (!projectId.success) return apiError("VALIDATION_ERROR", [{ field: "projectId", message: "Invalid project ID" }]);
  try {
    const changeOrders = await listChangeOrders(access.user.id, projectId.data);
    return changeOrders ? apiSuccess<ListChangeOrdersData>({ changeOrders }) : apiError("NOT_FOUND");
  } catch {
    console.error("Failed to list change orders.");
    return apiError("INTERNAL_ERROR");
  }
}

export async function POST(request: Request, { params }: Params) {
  const access = await authorizeRequest(request);
  if (access.response) return access.response;
  const projectId = projectIdSchema.safeParse((await params).projectId);
  if (!projectId.success) return apiError("VALIDATION_ERROR", [{ field: "projectId", message: "Invalid project ID" }]);
  const parsed = await parseBody(request, changeOrderInputSchema);
  if ("response" in parsed) return parsed.response;
  const input = parsed.data;
  try {
    const changeOrder = await withTransaction(async client => {
      // Lock the project so change order numbers are sequential per project.
      const owned = await client.query("SELECT id FROM projects WHERE id = $1 AND owner_user_id = $2 FOR UPDATE", [projectId.data, access.user.id]);
      if (!owned.rowCount) return undefined;
      if (input.requestId) {
        const linked = await client.query("SELECT 1 FROM requests WHERE id = $1 AND project_id = $2", [input.requestId, projectId.data]);
        if (!linked.rowCount) return undefined;
      }
      const result = await client.query(
        `INSERT INTO change_orders AS c (project_id, request_id, number, title, description, hours, amount_cents, currency)
         SELECT $1, $2, COALESCE(MAX(number), 0) + 1, $3, $4, $5, $6, $7 FROM change_orders WHERE project_id = $1
         RETURNING ${CHANGE_ORDER_COLUMNS}`,
        [projectId.data, input.requestId ?? null, input.title, input.description, input.hours ?? null,
          input.amount === undefined ? null : Math.round(input.amount * 100), input.currency],
      );
      return toChangeOrderDto(result.rows[0]);
    });
    return changeOrder ? apiSuccess<ChangeOrderData>({ changeOrder }, 201) : apiError("NOT_FOUND");
  } catch {
    console.error("Failed to create change order.");
    return apiError("INTERNAL_ERROR");
  }
}
