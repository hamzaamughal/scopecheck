import "server-only";
import { db } from "@/lib/db";
import { assessmentContextSchema, assessmentSchema, type Assessment, type AssessmentContext } from "@/schemas/assessment";
import { DOCUMENTS_HASH_SQL } from "@/lib/rag/documents-hash";
import type { GetAssessmentData } from "@/types/assessment";

export type AssessmentSource = { id: string; scope: string; title: string; description: string };

export async function getAssessmentSource(userId: string, projectId: string, requestId: string) {
  const result = await db.query<AssessmentSource>(
    `SELECT r.id, r.title, r.description, p.scope FROM requests r
     JOIN projects p ON p.id = r.project_id WHERE r.id = $1 AND p.id = $2 AND p.owner_user_id = $3`,
    [requestId, projectId, userId],
  );
  return result.rows[0];
}

// documentsHash/context are set when supporting documents were used (see lib/rag/assessment-context).
export async function saveAssessment(userId: string, projectId: string, source: AssessmentSource, model: string, assessment: Assessment,
  extra: { documentsHash: string | null; context: AssessmentContext | null } = { documentsHash: null, context: null }) {
  const result = await db.query<{ id: string }>(
    `INSERT INTO assessments (request_id, model, scope_snapshot, title_snapshot, description_snapshot, output, documents_hash, context)
     SELECT r.id, $2, $3, $4, $5, $6::jsonb, $9, $10::jsonb FROM requests r JOIN projects p ON p.id = r.project_id
     WHERE r.id = $1 AND p.id = $7 AND p.owner_user_id = $8 RETURNING id`,
    [source.id, model, source.scope, source.title, source.description, JSON.stringify(assessment), projectId, userId,
      extra.documentsHash, extra.context ? JSON.stringify(extra.context) : null],
  );
  if (!result.rows[0]) throw new Error("Assessment source no longer accessible");
  return result.rows[0].id;
}

type SavedRow = {
  request_id: string; id: string | null; model: string; output: unknown;
  created_at: Date; is_stale: boolean; context: unknown;
};

// One statement compares the saved source and the current source in the same DB snapshot.
export async function getSavedAssessment(userId: string, projectId: string, requestId: string, assessmentId: string | null = null): Promise<GetAssessmentData | undefined> {
  const result = await db.query<SavedRow>(
    `SELECT r.id AS request_id, a.id, a.model, a.output, a.created_at, a.context,
       (a.scope_snapshot IS DISTINCT FROM p.scope OR a.title_snapshot IS DISTINCT FROM r.title
        OR a.description_snapshot IS DISTINCT FROM r.description
        OR a.documents_hash IS DISTINCT FROM ${DOCUMENTS_HASH_SQL}) AS is_stale
     FROM requests r JOIN projects p ON p.id = r.project_id
     LEFT JOIN LATERAL (
       SELECT * FROM assessments WHERE request_id = r.id AND ($3::uuid IS NULL OR id = $3)
       ORDER BY created_at DESC, id DESC LIMIT 1
     ) a ON true
     WHERE r.id = $1 AND p.id = $2 AND p.owner_user_id = $4`,
    [requestId, projectId, assessmentId, userId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    requestId: row.request_id,
    assessment: row.id ? {
      ...assessmentSchema.parse(row.output), id: row.id, model: row.model,
      createdAt: row.created_at.toISOString(), isStale: row.is_stale,
      context: row.context ? assessmentContextSchema.parse(row.context) : null,
    } : null,
  };
}
