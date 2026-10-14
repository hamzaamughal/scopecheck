import "server-only";
import { db } from "@/lib/db";
import { ASSESSMENT_MODEL, assessRequest } from "@/lib/ai/assess-request";
import { assessRequestWithSources, type SupportingSource } from "@/lib/ai/assess-with-sources";
import { indexPendingDocuments } from "@/lib/rag/documents-repository";
import { hybridSearch } from "@/lib/rag/retrieve";
import { DOCUMENTS_HASH_SQL } from "@/lib/rag/documents-hash";
import { RETRIEVED_CHUNKS, planContext } from "@/lib/rag/plan";
import type { AssessmentSource } from "@/lib/assessment-repository";
import type { Assessment, AssessmentContext } from "@/schemas/assessment";
import type { DocumentKind } from "@/types/documents";

export type AssessmentRun = { assessment: Assessment; model: string; documentsHash: string | null; context: AssessmentContext | null };

// Runs one assessment for a request whose ownership the caller already verified (source came from
// getAssessmentSource with the user's id). Projects without documents use the original scope-only path unchanged.
export async function runAssessment(userId: string, projectId: string, source: AssessmentSource): Promise<AssessmentRun> {
  const docs = await db.query<{ id: string; title: string; kind: DocumentKind; text: string; chars: number; hash: string | null }>(
    `SELECT d.id, d.title, d.kind, d.text, length(d.text) AS chars, ${DOCUMENTS_HASH_SQL} AS hash
     FROM project_documents d JOIN projects p ON p.id = d.project_id
     WHERE d.project_id = $1 AND p.owner_user_id = $2 ORDER BY d.created_at, d.id`, [projectId, userId]);
  const plan = planContext(source.scope.length, docs.rows.map(row => row.chars));

  if (plan.mode === "scope_only") {
    const assessment = await assessRequest({ scope: source.scope, title: source.title, description: source.description });
    return { assessment, model: ASSESSMENT_MODEL, documentsHash: null, context: null };
  }

  const documentsHash = docs.rows[0].hash;
  let sources: SupportingSource[];
  let search: AssessmentContext["search"] = null;
  if (plan.mode === "full") {
    sources = docs.rows.map((doc, index) => ({ ref: `D${index + 1}`, documentId: doc.id, documentTitle: doc.title, documentKind: doc.kind, page: null, text: doc.text }));
  } else {
    await indexPendingDocuments(userId, projectId);
    const { chunks, usedVector } = await hybridSearch(projectId, `${source.title}\n${source.description}`, RETRIEVED_CHUNKS);
    search = usedVector ? "hybrid" : "keyword";
    sources = chunks.map((chunk, index) => ({ ref: `C${index + 1}`, documentId: chunk.documentId, documentTitle: chunk.documentTitle, documentKind: chunk.documentKind,
      page: chunk.page, text: chunk.heading && !chunk.text.startsWith(chunk.heading) ? `${chunk.heading}\n${chunk.text}` : chunk.text }));
  }
  const assessment = await assessRequestWithSources({ scope: source.scope, title: source.title, description: source.description, sources });
  return { assessment, model: ASSESSMENT_MODEL, documentsHash,
    context: { mode: plan.mode, documentCount: plan.documentCount, chunkCount: plan.mode === "retrieval" ? sources.length : 0, search } };
}
