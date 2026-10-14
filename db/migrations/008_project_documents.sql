-- Supporting documents (proposal, emails, notes) searched with hybrid retrieval (full-text + pgvector).
-- The agreed scope stays in projects.scope and is always sent to the AI in full; documents are context only.
-- Types and operator classes are schema-qualified so the migration also builds in a temporary schema (db:verify).
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

CREATE TABLE project_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('proposal', 'email', 'notes', 'other')),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  label TEXT CHECK (label IS NULL OR length(label) <= 300),
  source_url TEXT CHECK (source_url IS NULL OR length(source_url) <= 2048),
  page_count INTEGER CHECK (page_count IS NULL OR page_count > 0),
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 200000),
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  -- ready: every chunk has an embedding. keyword_only: embeddings unavailable, full-text search still works.
  index_status TEXT NOT NULL DEFAULT 'pending' CHECK (index_status IN ('pending', 'ready', 'keyword_only')),
  embedding_model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX project_documents_project_idx ON project_documents (project_id, created_at);

CREATE TABLE document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES project_documents(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  page INTEGER CHECK (page IS NULL OR page > 0),
  heading TEXT CHECK (heading IS NULL OR length(heading) <= 200),
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 4000),
  tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('english'::regconfig, coalesce(heading, '') || ' ' || text)) STORED,
  embedding public.vector(1536),
  UNIQUE (document_id, ordinal)
);
CREATE INDEX document_chunks_project_idx ON document_chunks (project_id);
CREATE INDEX document_chunks_tsv_idx ON document_chunks USING gin (tsv);
CREATE INDEX document_chunks_embedding_idx ON document_chunks USING hnsw (embedding public.vector_cosine_ops);

-- Per-user daily embedding budget (tokens), same atomic pattern as assessment_usage.
CREATE TABLE embedding_usage (
  user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  usage_day DATE NOT NULL,
  tokens INTEGER NOT NULL CHECK (tokens >= 0),
  PRIMARY KEY (user_id, usage_day)
);

-- What an assessment was based on besides the scope: a fingerprint of the project's documents
-- (to flag the assessment as outdated when documents change) and the retrieval details shown to the user.
ALTER TABLE assessments ADD COLUMN documents_hash TEXT;
ALTER TABLE assessments ADD COLUMN context JSONB;
