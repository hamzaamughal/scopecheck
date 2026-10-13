-- Baseline for a FRESH database only.
-- Databases created before this file existed already have these tables; scripts/migrate.mjs
-- records this file as applied without running it when both tables are present.
-- Matches the production schema as reported by `npm run db:verify` (2026-10-14); keep it in sync.
-- gen_random_uuid() is built into PostgreSQL 13+.

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  client_name TEXT,
  scope TEXT NOT NULL CHECK (length(trim(scope)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  decision TEXT CHECK (decision IN ('included', 'extra_work', 'needs_clarification')),
  decision_note TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A decision and its timestamp are always set (or cleared) together.
  CHECK ((decision IS NULL AND decided_at IS NULL) OR (decision IS NOT NULL AND decided_at IS NOT NULL))
);

CREATE INDEX requests_project_created_idx ON requests (project_id, created_at DESC);
