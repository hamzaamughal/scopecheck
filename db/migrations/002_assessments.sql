CREATE TABLE IF NOT EXISTS assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES requests(id) ON DELETE RESTRICT,
  model TEXT NOT NULL,
  scope_snapshot TEXT NOT NULL,
  title_snapshot TEXT NOT NULL,
  description_snapshot TEXT NOT NULL,
  output JSONB NOT NULL CHECK (jsonb_typeof(output) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS assessments_request_created_idx
  ON assessments (request_id, created_at DESC, id DESC);
