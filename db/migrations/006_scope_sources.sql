-- Where a project's scope text was imported from. Only extracted text is stored (in projects.scope);
-- original files are never uploaded. One row per project; removed with the project.
CREATE TABLE scope_sources (
  project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('file', 'link')),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 300),
  source_url TEXT CHECK (source_url IS NULL OR length(source_url) <= 2048),
  page_count INTEGER CHECK (page_count IS NULL OR page_count > 0),
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_checked_at TIMESTAMPTZ,
  CHECK ((kind = 'link') = (source_url IS NOT NULL))
);

-- Per-user daily count of server-side link imports (bounds outbound fetches).
CREATE TABLE import_usage (
  user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  usage_day DATE NOT NULL,
  used INTEGER NOT NULL CHECK (used >= 0),
  PRIMARY KEY (user_id, usage_day)
);
