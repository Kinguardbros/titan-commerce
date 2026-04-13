-- Avatar Studio: per-persona reference images for model consistency
CREATE TABLE IF NOT EXISTS persona_avatars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) NOT NULL,
  persona_name TEXT NOT NULL,
  label TEXT,
  age INTEGER,
  description TEXT,
  reference_url TEXT,
  variants JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(store_id, persona_name)
);
CREATE INDEX IF NOT EXISTS idx_persona_avatars_store ON persona_avatars(store_id);
