import "server-only";
import { db, withTransaction } from "@/lib/db";
import { chunkDocument } from "@/lib/rag/chunk";
import { activeEmbeddingModel, embedTexts, embeddingsAvailable, estimateTokens, toVectorLiteral } from "@/lib/rag/embeddings";
import type { DocumentInput } from "@/schemas/documents";
import type { ProjectDocumentDto } from "@/types/documents";

export const MAX_DOCUMENTS_PER_PROJECT = 10;

export function dailyEmbeddingTokens() {
  const limit = Number(process.env.RAG_DAILY_EMBEDDING_TOKENS ?? "500000");
  if (!Number.isSafeInteger(limit) || limit < 1000) throw new Error("RAG_DAILY_EMBEDDING_TOKENS must be an integer of at least 1000");
  return limit;
}

// Atomic budget check (row lock on conflict): never exceeds the daily token allowance.
export async function reserveEmbeddingTokens(userId: string, tokens: number): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO embedding_usage (user_id, usage_day, tokens)
     SELECT $1, (statement_timestamp() AT TIME ZONE 'UTC')::date, $2::int WHERE $2::int <= $3::int
     ON CONFLICT (user_id, usage_day) DO UPDATE SET tokens = embedding_usage.tokens + EXCLUDED.tokens
     WHERE embedding_usage.tokens + EXCLUDED.tokens <= $3::int RETURNING tokens`,
    [userId, tokens, dailyEmbeddingTokens()],
  );
  return result.rows.length === 1;
}

const DOCUMENT_COLUMNS = `d.id, d.kind, d.title, d.label, d.source_url AS "sourceUrl", d.page_count AS "pageCount",
  length(d.text) AS chars, (SELECT count(*)::int FROM document_chunks c WHERE c.document_id = d.id) AS "chunkCount",
  d.index_status AS "indexStatus", d.created_at AS "createdAt"`;
type DocumentRow = Omit<ProjectDocumentDto, "createdAt"> & { createdAt: Date };
const toDto = (row: DocumentRow): ProjectDocumentDto => ({ ...row, createdAt: row.createdAt.toISOString() });

export async function listDocuments(userId: string, projectId: string): Promise<ProjectDocumentDto[] | undefined> {
  const owned = await db.query("SELECT 1 FROM projects WHERE id = $1 AND owner_user_id = $2", [projectId, userId]);
  if (!owned.rowCount) return undefined;
  const result = await db.query<DocumentRow>(`SELECT ${DOCUMENT_COLUMNS} FROM project_documents d WHERE d.project_id = $1 ORDER BY d.created_at, d.id`, [projectId]);
  return result.rows.map(toDto);
}

export async function getDocumentText(userId: string, projectId: string, documentId: string) {
  const result = await db.query<DocumentRow & { text: string }>(
    `SELECT ${DOCUMENT_COLUMNS}, d.text FROM project_documents d JOIN projects p ON p.id = d.project_id
     WHERE d.id = $1 AND d.project_id = $2 AND p.owner_user_id = $3`, [documentId, projectId, userId]);
  const row = result.rows[0];
  return row ? { ...toDto(row), text: row.text } : undefined;
}

export type CreateDocumentResult = { status: "created"; id: string } | { status: "not_found" } | { status: "limit" };

// Stores the document and its chunks in one transaction (the project row lock serialises the per-project limit).
// Embeddings are added afterwards by indexDocument, so a provider outage never blocks saving.
export async function createDocument(userId: string, projectId: string, input: DocumentInput & { contentHash: string }): Promise<CreateDocumentResult> {
  const chunks = chunkDocument(input.text);
  return withTransaction(async client => {
    const owned = await client.query("SELECT 1 FROM projects WHERE id = $1 AND owner_user_id = $2 FOR UPDATE", [projectId, userId]);
    if (!owned.rowCount) return { status: "not_found" } as const;
    const count = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM project_documents WHERE project_id = $1", [projectId]);
    if (count.rows[0].n >= MAX_DOCUMENTS_PER_PROJECT) return { status: "limit" } as const;
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO project_documents (project_id, kind, title, label, source_url, page_count, text, content_hash, index_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [projectId, input.kind, input.title, input.label ?? null, input.sourceUrl ?? null, input.pageCount ?? null, input.text, input.contentHash,
        embeddingsAvailable() ? "pending" : "keyword_only"],
    );
    const id = inserted.rows[0].id;
    await client.query(
      `INSERT INTO document_chunks (document_id, project_id, ordinal, page, heading, text)
       SELECT $1, $2, c.ordinal, c.page, c.heading, c.text
       FROM unnest($3::int[], $4::int[], $5::text[], $6::text[]) AS c(ordinal, page, heading, text)`,
      [id, projectId, chunks.map(c => c.ordinal), chunks.map(c => c.page), chunks.map(c => c.heading), chunks.map(c => c.text)],
    );
    return { status: "created", id } as const;
  });
}

// Embeds a document's chunks that have no vector yet. Best effort: on budget or provider failure the
// document is marked keyword_only and stays searchable through full-text search.
export async function indexDocument(userId: string, documentId: string): Promise<"ready" | "keyword_only"> {
  const pending = await db.query<{ id: string; heading: string | null; text: string }>(
    "SELECT id, heading, text FROM document_chunks WHERE document_id = $1 AND embedding IS NULL ORDER BY ordinal", [documentId]);
  const texts = pending.rows.map(row => row.heading && !row.text.startsWith(row.heading) ? `${row.heading}\n${row.text}` : row.text);
  let status: "ready" | "keyword_only" = "keyword_only";
  try {
    if (!texts.length) status = "ready";
    else if (embeddingsAvailable() && await reserveEmbeddingTokens(userId, estimateTokens(texts))) {
      const { vectors, model } = await embedTexts(texts);
      await db.query(
        `UPDATE document_chunks c SET embedding = v.embedding::public.vector
         FROM unnest($1::uuid[], $2::text[]) AS v(id, embedding) WHERE c.id = v.id`,
        [pending.rows.map(row => row.id), vectors.map(toVectorLiteral)],
      );
      await db.query("UPDATE project_documents SET embedding_model = $2 WHERE id = $1", [documentId, model]);
      status = "ready";
    }
  } catch (error) {
    console.error("Document embedding failed; falling back to keyword search.", { errorType: error instanceof Error ? error.name : "UnknownError" });
  }
  await db.query("UPDATE project_documents SET index_status = $2 WHERE id = $1", [documentId, status]);
  return status;
}

export async function deleteDocument(userId: string, projectId: string, documentId: string) {
  const result = await db.query(
    `DELETE FROM project_documents d USING projects p
     WHERE d.id = $1 AND d.project_id = $2 AND p.id = d.project_id AND p.owner_user_id = $3`, [documentId, projectId, userId]);
  return result.rowCount === 1;
}

// Re-tries embedding for documents saved while the provider was unavailable (called before retrieval).
export async function indexPendingDocuments(userId: string, projectId: string) {
  if (!embeddingsAvailable()) return;
  const model = activeEmbeddingModel();
  const stale = await db.query<{ id: string }>(
    `SELECT id FROM project_documents WHERE project_id = $1
       AND (index_status <> 'ready' OR embedding_model IS DISTINCT FROM $2) ORDER BY created_at LIMIT 3`, [projectId, model]);
  for (const row of stale.rows) {
    // A model switch invalidates vectors: clear them so they are rebuilt with the active model.
    await db.query(
      `UPDATE document_chunks c SET embedding = NULL FROM project_documents d
       WHERE c.document_id = d.id AND d.id = $1 AND d.embedding_model IS NOT NULL AND d.embedding_model <> $2`, [row.id, model]);
    await indexDocument(userId, row.id);
  }
}
