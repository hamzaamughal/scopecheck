import { z } from "zod";
import { authorizeRequest } from "@/lib/auth-session";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/api-response";
import { fieldErrors, parseBody } from "@/lib/route-helpers";
import { reserveAssessment } from "@/lib/assessment-usage";
import { aiConfigured, draftClientReply } from "@/lib/ai/draft-reply";
import { formatMoney, getLatestReplyDraft } from "@/lib/workflow-repository";
import { replyDraftInputSchema } from "@/schemas/workflow";
import type { RequestDecision } from "@/types/request";
import type { ReplyDraftData } from "@/types/workflow";

type Params = { params: Promise<{ projectId: string }> };
const projectIdSchema = z.string().uuid("Invalid project ID");

// GET ?requestId=… -> latest saved draft (no AI call)
export async function GET(request: Request, { params }: Params) {
  const access = await authorizeRequest(request);
  if (access.response) return access.response;
  const ids = z.object({ projectId: projectIdSchema, requestId: z.string().uuid("Invalid request ID") })
    .safeParse({ projectId: (await params).projectId, requestId: new URL(request.url).searchParams.get("requestId") });
  if (!ids.success) return apiError("VALIDATION_ERROR", fieldErrors(ids.error));
  try {
    const found = await getLatestReplyDraft(access.user.id, ids.data.projectId, ids.data.requestId);
    return found ? apiSuccess<ReplyDraftData>({ requestId: ids.data.requestId, draft: found.draft }) : apiError("NOT_FOUND");
  } catch {
    console.error("Failed to load reply draft.");
    return apiError("INTERNAL_ERROR");
  }
}

type Source = {
  scope: string; clientName: string | null; title: string; description: string; decision: RequestDecision | null; decisionNote: string | null;
  explanation: string | null; questions: string[] | null;
  coId: string | null; coNumber: number | null; coTitle: string | null; coDescription: string | null; coHours: number | null; coAmount: string | null; coCurrency: string | null;
};

// POST { requestId, tone } -> generates and saves a new draft (uses the shared daily AI allowance)
export async function POST(request: Request, { params }: Params) {
  const access = await authorizeRequest(request);
  if (access.response) return access.response;
  const projectId = projectIdSchema.safeParse((await params).projectId);
  if (!projectId.success) return apiError("VALIDATION_ERROR", fieldErrors(projectId.error));
  const parsed = await parseBody(request, replyDraftInputSchema);
  if ("response" in parsed) return parsed.response;
  const { requestId, tone } = parsed.data;

  let source: Source | undefined;
  try {
    const result = await db.query<Source>(
      `SELECT p.scope, p.client_name AS "clientName", r.title, r.description, r.decision, r.decision_note AS "decisionNote",
         a.output->>'explanation' AS explanation, ARRAY(SELECT jsonb_array_elements_text(a.output->'clarificationQuestions')) AS questions,
         c.id AS "coId", c.number AS "coNumber", c.title AS "coTitle", c.description AS "coDescription", c.hours::float8 AS "coHours",
         c.amount_cents::text AS "coAmount", c.currency AS "coCurrency"
       FROM requests r JOIN projects p ON p.id = r.project_id
       LEFT JOIN LATERAL (SELECT output FROM assessments WHERE request_id = r.id ORDER BY created_at DESC, id DESC LIMIT 1) a ON true
       LEFT JOIN LATERAL (SELECT * FROM change_orders WHERE request_id = r.id AND status <> 'rejected' ORDER BY number DESC LIMIT 1) c ON true
       WHERE r.id = $1 AND p.id = $2 AND p.owner_user_id = $3`, [requestId, projectId.data, access.user.id]);
    source = result.rows[0];
  } catch {
    console.error("Failed to load reply source.");
    return apiError("INTERNAL_ERROR");
  }
  if (!source) return apiError("NOT_FOUND");
  if (!source.decision) return apiError("DECISION_REQUIRED");
  if (!aiConfigured()) return apiError("AI_NOT_CONFIGURED");

  try {
    if (!(await reserveAssessment(access.user.id))) return apiError("ASSESSMENT_LIMIT_REACHED");
  } catch {
    return apiError("DATABASE_UNAVAILABLE");
  }

  const decision = source.decision;
  const estimate = [source.coHours !== null ? `${source.coHours} hours` : "", source.coAmount !== null ? formatMoney(Number(source.coAmount), source.coCurrency ?? "USD") : ""].filter(Boolean).join(" · ") || null;
  let draft: { body: string; model: string };
  try {
    draft = await draftClientReply({
      freelancerName: access.user.name, clientName: source.clientName, scope: source.scope,
      request: { title: source.title, description: source.description }, decision, decisionNote: source.decisionNote, tone,
      assessment: source.explanation ? { explanation: source.explanation, clarificationQuestions: source.questions ?? [] } : null,
      changeOrder: source.coId && source.coNumber && source.coTitle && source.coDescription ? { number: source.coNumber, title: source.coTitle, description: source.coDescription, estimate } : null,
    });
  } catch (error) {
    console.error("[reply-draft]", error instanceof Error && error.message.startsWith("Rejected reply draft") ? error.message : "Generation failed.");
    return apiError("REPLY_FAILED");
  }

  try {
    // Saved only if the request is still owned and its decision unchanged since generation started.
    const saved = await db.query(
      `INSERT INTO reply_drafts (request_id, decision, tone, body, model, change_order_id)
       SELECT r.id, $2, $3, $4, $5, $6 FROM requests r JOIN projects p ON p.id = r.project_id
       WHERE r.id = $1 AND p.id = $7 AND p.owner_user_id = $8 AND r.decision = $2 RETURNING id`,
      [requestId, decision, tone, draft.body, draft.model, source.coId, projectId.data, access.user.id]);
    if (!saved.rowCount) return apiError("CONFLICT");
    const found = await getLatestReplyDraft(access.user.id, projectId.data, requestId);
    return apiSuccess<ReplyDraftData>({ requestId, draft: found?.draft ?? null }, 201);
  } catch {
    console.error("Failed to save reply draft.");
    return apiError("INTERNAL_ERROR");
  }
}
