-- Scope history, change orders, and AI-drafted client replies.

-- Every saved state of a project's scope. Version 1 is backfilled from the current scope.
CREATE TABLE scope_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  scope TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('initial', 'edit', 'import', 'link_update', 'change_order')),
  change_order_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (project_id, version)
);

-- Extra work proposed to the client. Accepting one appends it to the scope as a new version.
CREATE TABLE change_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  request_id UUID REFERENCES requests(id) ON DELETE SET NULL,
  number INTEGER NOT NULL CHECK (number > 0),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 5000),
  hours NUMERIC(8, 2) CHECK (hours IS NULL OR hours >= 0),
  amount_cents BIGINT CHECK (amount_cents IS NULL OR amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'rejected')),
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, number),
  CHECK ((status = 'proposed') = (decided_at IS NULL))
);
CREATE INDEX change_orders_request_idx ON change_orders (request_id);

ALTER TABLE scope_versions ADD CONSTRAINT scope_versions_change_order_fkey
  FOREIGN KEY (change_order_id) REFERENCES change_orders(id) ON DELETE SET NULL;

-- AI-drafted replies to the client. History is kept; the newest is shown.
CREATE TABLE reply_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('included', 'extra_work', 'needs_clarification')),
  tone TEXT NOT NULL CHECK (tone IN ('friendly', 'formal')),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 6000),
  model TEXT NOT NULL,
  change_order_id UUID REFERENCES change_orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX reply_drafts_request_created_idx ON reply_drafts (request_id, created_at DESC, id DESC);

INSERT INTO scope_versions (project_id, version, scope, reason, created_at)
SELECT id, 1, scope, 'initial', created_at FROM projects;
