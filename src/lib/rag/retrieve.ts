import "server-only";
import { db } from "@/lib/db";
import { embedTexts, embeddingsAvailable, activeEmbeddingModel, toVectorLiteral } from "@/lib/rag/embeddings";
import { orQueryTerms, reciprocalRankFusion } from "@/lib/rag/rrf";
import { KEYWORD_SEARCH_SQL, VECTOR_SEARCH_SQL } from "@/lib/rag/search-sql";
import type { DocumentKind } from "@/types/documents";

export const CANDIDATES_PER_LIST = 20;

export type RetrievedChunk = {
  id: string; documentId: string; documentTitle: string; documentKind: DocumentKind;
  page: number | null; heading: string | null; text: string;
  keywordRank: number | null; vectorRank: number | null; score: number;
};

// Hybrid search over one project's document chunks:
//   1. full-text (OR of the request's terms, ranked by ts_rank_cd)
//   2. vector similarity (cosine distance on pgvector), when embeddings exist for the active model
// The two ranked lists are merged with reciprocal rank fusion. Ownership is checked by the caller.
export async function hybridSearch(projectId: string, query: string, limit: number): Promise<{ chunks: RetrievedChunk[]; usedVector: boolean }> {
  const terms = orQueryTerms(query);
  const keyword = terms.length ? await db.query<{ id: string }>(KEYWORD_SEARCH_SQL, [projectId, terms, CANDIDATES_PER_LIST]) : { rows: [] };

  let vectorIds: string[] = [];
  let usedVector = false;
  if (embeddingsAvailable()) {
    const model = activeEmbeddingModel();
    const indexed = await db.query(
      `SELECT 1 FROM document_chunks c JOIN project_documents d ON d.id = c.document_id
       WHERE c.project_id = $1 AND c.embedding IS NOT NULL AND d.embedding_model = $2 LIMIT 1`, [projectId, model]);
    if (indexed.rowCount) {
      try {
        const { vectors: [vector] } = await embedTexts([query], 10_000);
        const result = await db.query<{ id: string }>(VECTOR_SEARCH_SQL, [projectId, toVectorLiteral(vector), model, CANDIDATES_PER_LIST]);
        vectorIds = result.rows.map(row => row.id);
        usedVector = true;
      } catch (error) {
        console.error("Query embedding failed; using keyword search only.", { errorType: error instanceof Error ? error.name : "UnknownError" });
      }
    }
  }

  const keywordIds = keyword.rows.map(row => row.id);
  const fused = reciprocalRankFusion([keywordIds, vectorIds], limit);
  if (!fused.length) return { chunks: [], usedVector };
  const details = await db.query<Omit<RetrievedChunk, "keywordRank" | "vectorRank" | "score">>(
    `SELECT c.id, c.document_id AS "documentId", d.title AS "documentTitle", d.kind AS "documentKind", c.page, c.heading, c.text
     FROM document_chunks c JOIN project_documents d ON d.id = c.document_id WHERE c.id = ANY($1::uuid[])`, [fused.map(item => item.id)]);
  const byId = new Map(details.rows.map(row => [row.id, row]));
  const rankOf = (list: string[], id: string) => { const index = list.indexOf(id); return index < 0 ? null : index + 1; };
  const chunks = fused.flatMap(({ id, score }) => {
    const row = byId.get(id);
    return row ? [{ ...row, score, keywordRank: rankOf(keywordIds, id), vectorRank: rankOf(vectorIds, id) }] : [];
  });
  return { chunks, usedVector };
}
