ALTER TABLE projects ADD COLUMN owner_user_id TEXT REFERENCES auth_user(id) ON DELETE RESTRICT;
ALTER TABLE projects ADD COLUMN legacy_owner_email TEXT;
CREATE INDEX projects_owner_created_idx ON projects (owner_user_id, created_at DESC, id DESC);
