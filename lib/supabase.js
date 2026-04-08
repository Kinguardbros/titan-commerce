import { createClient } from '@supabase/supabase-js';

// Server-side Supabase client — use in API routes / serverless functions only
// NEVER expose SUPABASE_SERVICE_ROLE_KEY to the frontend
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default supabase;
