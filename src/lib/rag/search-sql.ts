// SQL for hybrid retrieval, shared by the app (lib/rag/retrieve.ts) and the offline retrieval eval,
// so the eval measures exactly the queries production runs.

// $1 project id, $2 text[] of query terms (OR-ed), $3 limit. Ranked by ts_rank_cd (cover density).
export const KEYWORD_SEARCH_SQL = `
  WITH q AS (
    SELECT nullif(string_agg(nullif(plainto_tsquery('english', term)::text, ''), ' | '), '')::tsquery AS tsq
    FROM unnest($2::text[]) AS term)
  SELECT c.id FROM document_chunks c, q
  WHERE c.project_id = $1 AND q.tsq IS NOT NULL AND c.tsv @@ q.tsq
  ORDER BY ts_rank_cd(c.tsv, q.tsq) DESC, c.id LIMIT $3`;

// $1 project id, $2 query vector literal, $3 embedding model, $4 limit. Cosine distance (pgvector <=>).
export const VECTOR_SEARCH_SQL = `
  SELECT c.id FROM document_chunks c JOIN project_documents d ON d.id = c.document_id
  WHERE c.project_id = $1 AND c.embedding IS NOT NULL AND d.embedding_model = $3
  ORDER BY c.embedding OPERATOR(public.<=>) $2::public.vector, c.id LIMIT $4`;
