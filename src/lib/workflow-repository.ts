import "server-only";
import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import type { ChangeOrderDto, ReplyDraftDto, ScopeVersionDto, ScopeVersionReason } from "@/types/workflow";
export { changeOrderAddendum, formatMoney } from "./change-order-text.ts";

// ---------- Scope versions ----------

// Appends the project's current scope as a new version, unless it equals the latest one.
// Callers must hold the project row lock (UPDATE or SELECT ... FOR UPDATE) in the same transaction,
// which serializes version numbers per project.
export async function recordScopeVersion(client: PoolClient, projectId: string, reason: ScopeVersionReason, changeOrderId: string | null = null) {
  await client.query(
    `INSERT INTO scope_versions (project_id, version, scope, reason, change_order_id)
     SELECT p.id, COALESCE(last.version, 0) + 1, p.scope, $2, $3
     FROM projects p
     LEFT JOIN LATERAL (SELECT version, scope FROM scope_versions WHERE project_id = p.id ORDER BY version DESC LIMIT 1) last ON true
     WHERE p.id = $1 AND last.scope IS DISTINCT FROM p.scope`,
    [projectId, reason, changeOrderId],
  );
}

type VersionRow = { id: string; version: number; reason: ScopeVersionReason; changeOrderNumber: number | null; createdAt: Date; length: number; scope?: string };
const toVersion = (row: VersionRow): ScopeVersionDto => ({ id: row.id, version: row.version, reason: row.reason, changeOrderNumber: row.changeOrderNumber, createdAt: row.createdAt.toISOString(), length: row.length });

export async function listScopeVersions(userId: string, projectId: string) {
  const owned = await db.query("SELECT 1 FROM projects WHERE id = $1 AND owner_user_id = $2", [projectId, userId]);
  if (!owned.rowCount) return undefined;
  const result = await db.query<VersionRow>(
    `SELECT v.id, v.version, v.reason, c.number AS "changeOrderNumber", v.created_at AS "createdAt", length(v.scope) AS length
     FROM scope_versions v LEFT JOIN change_orders c ON c.id = v.change_order_id
     WHERE v.project_id = $1 ORDER BY v.version DESC`, [projectId]);
  return result.rows.map(toVersion);
}

export async function getScopeVersion(userId: string, projectId: string, version: number) {
  const result = await db.query<VersionRow & { scope: string }>(
    `SELECT v.id, v.version, v.reason, c.number AS "changeOrderNumber", v.created_at AS "createdAt", length(v.scope) AS length, v.scope
     FROM scope_versions v JOIN projects p ON p.id = v.project_id LEFT JOIN change_orders c ON c.id = v.change_order_id
     WHERE v.project_id = $1 AND p.owner_user_id = $2 AND v.version = $3`, [projectId, userId, version]);
  const row = result.rows[0];
  return row ? { ...toVersion(row), scope: row.scope } : undefined;
}

// ---------- Change orders ----------

export const CHANGE_ORDER_COLUMNS = `c.id, c.project_id AS "projectId", c.request_id AS "requestId", c.number, c.title, c.description,
  c.hours::float8 AS hours, c.amount_cents AS "amountCents", c.currency, c.status,
  c.decided_at AS "decidedAt", c.created_at AS "createdAt", c.updated_at AS "updatedAt"`;

type ChangeOrderRow = Omit<ChangeOrderDto, "decidedAt" | "createdAt" | "updatedAt" | "amountCents"> & { amountCents: string | number | null; decidedAt: Date | null; createdAt: Date; updatedAt: Date };
export function toChangeOrderDto(row: ChangeOrderRow): ChangeOrderDto {
  return {
    ...row, amountCents: row.amountCents === null ? null : Number(row.amountCents),
    decidedAt: row.decidedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listChangeOrders(userId: string, projectId: string) {
  const owned = await db.query("SELECT 1 FROM projects WHERE id = $1 AND owner_user_id = $2", [projectId, userId]);
  if (!owned.rowCount) return undefined;
  const result = await db.query<ChangeOrderRow>(`SELECT ${CHANGE_ORDER_COLUMNS} FROM change_orders c WHERE c.project_id = $1 ORDER BY c.number DESC`, [projectId]);
  return result.rows.map(toChangeOrderDto);
}

// ---------- Reply drafts ----------

type DraftRow = Omit<ReplyDraftDto, "createdAt"> & { createdAt: Date };
export async function getLatestReplyDraft(userId: string, projectId: string, requestId: string) {
  const result = await db.query<DraftRow>(
    `SELECT r.id AS "requestId", d.id, d.decision, d.tone, d.body, d.model, d.created_at AS "createdAt", c.number AS "changeOrderNumber",
       (d.decision IS DISTINCT FROM r.decision) AS "isStale"
     FROM requests r JOIN projects p ON p.id = r.project_id
     LEFT JOIN LATERAL (SELECT * FROM reply_drafts WHERE request_id = r.id ORDER BY created_at DESC, id DESC LIMIT 1) d ON true
     LEFT JOIN change_orders c ON c.id = d.change_order_id
     WHERE r.id = $1 AND p.id = $2 AND p.owner_user_id = $3`, [requestId, projectId, userId]);
  const row = result.rows[0];
  if (!row) return undefined;
  if (!row.id) return { draft: null };
  const draft: ReplyDraftDto = { id: row.id, requestId: row.requestId, decision: row.decision, tone: row.tone, body: row.body, model: row.model,
    createdAt: row.createdAt.toISOString(), changeOrderNumber: row.changeOrderNumber, isStale: row.isStale };
  return { draft };
}
