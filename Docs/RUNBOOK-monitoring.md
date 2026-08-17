# Runbook — Error monitoring & uptime checks

Titan Commerce had **zero production monitoring** as of `Docs/AUDIT-2026-08.md` P1-21: no Sentry,
Datadog, uptime monitor, PagerDuty, or log aggregator anywhere in the codebase. The only error
visibility was `console.error`/`console.warn` writing into raw Vercel function logs — fine for one
person checking logs when something breaks, not fine once cron/webhook/generation traffic scales
across more stores and more people who won't proactively tail logs.

This runbook covers the two free-tier layers that fix that.

---

## 1. Sentry — backend error capture (already wired, opt-in via env var)

**Code is already deployed.** `lib/sentry.js` wraps `@sentry/node` with a fail-open no-op: if
`SENTRY_DSN` is unset, `initSentry()` and `captureException()` do nothing and every existing deploy
behaves exactly as before. Nothing breaks until Dan sets the env var.

Wired into 3 entry points:
- `api/system.js` — the main dispatcher (60+ actions). Every action's catch-all now calls
  `captureException(err, { tags: { action } })` before the existing sanitize/console.error/response flow.
- `api/cron/detect-events.js` — the daily 08:00 UTC cron's catch-all. Cron failures were previously
  console.error-only (P1-20 finding) — nobody would see a failed run unless they went looking.
- `api/webhooks/shopify.js` — the Shopify webhook receiver's handler-error catch. A silently dropped
  `products/update` webhook means a product goes stale in TC with zero signal.

`tracesSampleRate: 0` — error-only reporting, no performance tracing. Keeps volume low on Sentry's
free tier (5,000 errors/month as of writing — plenty for this traffic level).

### Setup (2 minutes)

1. Sign up at [sentry.io](https://sentry.io) — free tier, no credit card.
2. Create a project → platform **Node.js** (not Next.js — this is plain Vercel serverless functions).
3. Copy the DSN from Settings → Projects → (project) → Client Keys (DSN).
4. Vercel dashboard → titan-commerce project → Settings → Environment Variables → add `SENTRY_DSN`
   → redeploy (env var changes need a redeploy to take effect in serverless functions).
5. Trigger any action error (or wait for a real one) and confirm it shows up in the Sentry Issues tab.

### What you get

- Every unhandled action/cron/webhook error, deduplicated by stack trace, with the `action` (or
  `topic`/`shop` for webhooks) as a searchable tag.
- Email alert on new issue types by default (Sentry's out-of-the-box alert rule). Configure
  Slack/Discord/PagerDuty integrations under Settings → Integrations if you want a channel instead of
  email — free tier supports basic Slack.

### Not done (deliberately out of scope for MVP)

- **Session Replay / distributed tracing** — Sentry Pro features, not needed to just know something broke.
- **Alert rules beyond the default "new issue" email** — revisit once real error volume gives a sense
  of what's noise vs. signal.

---

## 2. Uptime monitor — is the app even up

Sentry only fires when code *runs and throws*. It says nothing if Vercel itself is down, DNS breaks,
or the app hangs. That needs a separate synthetic check hitting the URL from outside.

### Recommended: Better Stack (formerly Better Uptime)

Free tier: 10 monitors, checks every 3 min, email + basic Slack/Discord alerting. (UptimeRobot is the
other common free option — 50 monitors, 5-min interval — pick whichever UI you prefer; Better Stack's
incident page is nicer if you ever want a public status page later.)

### Setup (2 minutes)

1. Sign up at [betterstack.com/uptime](https://betterstack.com/uptime) (or
   [uptimerobot.com](https://uptimerobot.com)) — free tier, no credit card.
2. Add a monitor for each URL below.
3. Set alert channel(s): email at minimum; add the Slack webhook under Integrations if store owners
   want a shared channel to know when something's down (optional — ask before adding a shared
   Slack integration, this is a "would they want to know" call, not a technical one).
4. Set threshold: **2 consecutive failures** at a 5-min check interval before alerting (≈10 min to
   first alert) — avoids false-positives from a single slow cold start.

### URLs to monitor

| URL | What it proves | Auth |
|---|---|---|
| `https://titan-commerce.vercel.app/api/system?action=health` | Backend function is up and responding. Public, unauthenticated — added specifically as the monitor target (`lib/actions/health.js`, `?action=health` in `PUBLIC_ACTIONS`). Returns `{ ok: true, ts, ver }`. Nested inside `api/system.js` instead of a new `api/health.js` route to stay within the Vercel Hobby 12-route budget (see CLAUDE.md "Vercel Hobby Limits" — the route budget is currently full). | None |
| `https://titan-commerce.vercel.app/` | Frontend dashboard bundle serves. Catches a broken Vite build / bad deploy that `?action=health` alone wouldn't (health lives in the API layer, not the static bundle). | None |
| `https://titan-commerce.vercel.app/api/system?action=stores_list` (optional, deeper check) | Confirms the backend can actually reach Supabase and read real data, not just that the process is alive. Requires auth — generate a dedicated API token via `generate_api_token` (admin-only action, Settings → Users → API token) and set it as a Bearer token / `Authorization: Bearer <token>` header on the monitor request. Use a token scoped to a low-privilege user if you don't want the monitor itself holding admin-equivalent access. | `Authorization: Bearer <api_token>` |

Start with the two unauthenticated checks (`?action=health` + `/`) — they're zero-setup. Add the
`stores_list` deep check later if "the process is up but DB calls are failing" turns out to be a
failure mode worth catching separately (it would currently also show up in Sentry the moment a real
user hits an action that touches Supabase, so the marginal value is catching it *before* a user does).

---

## 3. Follow-ups not done here (documented, not built)

- **Sentry Replay / performance tracing** — Pro-tier features. Skip until free-tier error capture
  proves useful and there's a concrete debugging need traces would solve.
- **Datadog** — enterprise-grade, way beyond what a 3-6 store platform needs. Ignore.
- **Vercel Log Drain** — could stream raw function logs to Sentry, Better Stack, or S3 for longer
  retention / full-text search across all logs (not just captured exceptions). Worth revisiting once
  log volume or a specific "I need to grep last week's logs" need justifies the setup.
- **Real alerting tied to specific critical actions** (a failed Shopify push, a cron run that silently
  skipped a store, a webhook HMAC rejection) — Sentry's per-`action`/`topic` tags plus a saved search
  or custom alert rule (Settings → Alerts → new rule, e.g. "issue with tag `action:push_creative_to_shopify`
  fires immediately") gets most of the way there without building bespoke alerting. Set this up once
  it's clear which actions are the ones worth a dedicated alert vs. just showing up in the normal issue
  stream.

---

## Source

`Docs/AUDIT-2026-08.md` P1-21 — "No monitoring/error alerting anywhere (Sentry/Datadog/uptime)."
