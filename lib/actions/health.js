// Public, unauthenticated health-check action for uptime monitors (P1-21, AUDIT-2026-08).
// Reachable via GET /api/system?action=health — 'health' is in PUBLIC_ACTIONS
// (lib/auth.js), so it skips withAuth entirely. Deliberately touches no DB/store data —
// just process liveness — so it's safe to expose without auth and cheap to poll every
// 5 min. Nested inside system.js instead of a new api/health.js route to preserve the
// Vercel Hobby 12-route budget (see CLAUDE.md "Vercel Hobby Limits").
export async function health(req, res) {
  return res.status(200).json({
    ok: true,
    ts: Date.now(),
    ver: process.env.VERCEL_GIT_COMMIT_SHA || 'dev',
  });
}
