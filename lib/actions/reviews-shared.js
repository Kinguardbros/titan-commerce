import { createClient } from '@supabase/supabase-js';

// Shared service-role client + helpers for the product reviews modules
// (reviews.js core + reviews-import / reviews-ai / reviews-photo).
export const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Summary (★ average + count) is computed from approved + published reviews only.
export function computeSummary(reviews) {
  const counted = (reviews || []).filter((r) => r.status === 'approved' || r.status === 'published');
  if (!counted.length) return { count: 0, average: 0 };
  const sum = counted.reduce((s, r) => s + r.rating, 0);
  return { count: counted.length, average: Math.round((sum / counted.length) * 10) / 10 };
}
