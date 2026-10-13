CREATE TABLE assessment_usage (
  user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  usage_day DATE NOT NULL,
  used INTEGER NOT NULL CHECK (used >= 0),
  PRIMARY KEY (user_id, usage_day)
);
