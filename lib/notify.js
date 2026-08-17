// Backend error monitoring — Telegram bot (replaces Sentry, P1-21 follow-up).
// Zero-cost DIY per Dan's preference over paid tools. Fail-open by design: if
// TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is unset, every export here is a no-op —
// existing console.error-only behavior is unchanged and no deploy breaks because
// Dan hasn't set the two env vars yet. Uses native `fetch` (Node 20+) — no SDK,
// no new dependency.
//
// `initSentry` / `captureException` export names are KEPT (not renamed to
// initNotify/notifyError) for backward compat: 4 call sites import this module
// (api/system.js, api/cron/detect-events.js, api/webhooks/shopify.js,
// lib/actions/reviews-push.js) — at 4 sites, changing every call site's import
// name is more churn than keeping the names and swapping only what's behind them.
// `initSentry()` is now a true no-op kept only so those 4 call sites don't need
// touching beyond the import path; Telegram needs no init step (no SDK to construct,
// no client object to hold) — sending is stateless per-call in `captureException`.
//
// Each Vercel serverless function is its own isolated process, so this is imported
// and initSentry() is called at module top in every entry point that wants coverage,
// same pattern as before.
//
// No rate limiting: Telegram allows ~30 msg/sec per chat; Titan's error volume is
// far below that. No deduplication: N identical errors send N Telegram messages —
// a documented tradeoff, not a bug. See Docs/RUNBOOK-monitoring.md.

export function initSentry() {
  // No-op. Kept for call-site compat — see module comment above.
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return; // fail-open: no config = no-op

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 4000), // Telegram max 4096, headroom
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error('[notify] Telegram send failed:', res.status, body.slice(0, 200));
  }
}

export async function captureException(err, { tags = {} } = {}) {
  const tagLines = Object.entries(tags)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: \`${v}\``);
  const parts = [
    '🚨 *Titan Commerce error*',
    ...tagLines,
    `Error: ${err.message}`,
    err.stack ? '```\n' + err.stack.split('\n').slice(0, 8).join('\n') + '\n```' : null,
    `Env: ${process.env.VERCEL_ENV || 'unknown'}`,
    `Time: ${new Date().toISOString()}`,
  ].filter(Boolean).join('\n');
  // captureException must never throw and break the caller's request/cron/webhook
  // flow — fail-open covers both the "unset env vars" case (handled inside
  // sendTelegram) and any runtime failure (network error, Telegram API outage).
  await sendTelegram(parts).catch((e) => console.error('[notify] captureException failed:', e.message));
}
