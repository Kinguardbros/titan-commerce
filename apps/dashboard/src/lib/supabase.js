import { createClient } from '@supabase/supabase-js';

// Client-side Supabase client — uses anon key (safe for browser)
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export default supabase;
