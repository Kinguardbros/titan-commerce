-- Sprint 1: Persistent rate limiting for serverless
CREATE TABLE IF NOT EXISTS rate_limits (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_key_time ON rate_limits(key, created_at);
