-- Avatar fire-and-forget pattern: backend submits to fal.ai then returns immediately;
-- poll_avatar_generations action periodically checks status and finalizes when done.
-- This avoids Vercel 60s timeout for slow Nano Banana Pro generations (60-90s typical).

ALTER TABLE persona_avatars
  ADD COLUMN IF NOT EXISTS status TEXT,                  -- NULL = legacy/done, 'generating' = front pending, 'angles' = front done + angle pending, 'failed' = error
  ADD COLUMN IF NOT EXISTS front_request_id TEXT,        -- fal.ai request_id for the front shot
  ADD COLUMN IF NOT EXISTS front_poll_base TEXT,         -- fal.ai poll base path (e.g. "fal-ai/nano-banana-pro")
  ADD COLUMN IF NOT EXISTS angle_request_id TEXT,        -- fal.ai request_id for the 3/4 angle (after front completes)
  ADD COLUMN IF NOT EXISTS angle_poll_base TEXT,
  ADD COLUMN IF NOT EXISTS gen_metadata JSONB DEFAULT '{}'::jsonb;  -- { prompt, prompt_3q, full_description, store_slug, submitted_at, error }

CREATE INDEX IF NOT EXISTS idx_persona_avatars_status ON persona_avatars(status) WHERE status IS NOT NULL;
