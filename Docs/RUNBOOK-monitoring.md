# Runbook — Error monitoring & uptime checks

Titan Commerce had **zero production monitoring** as of `Docs/AUDIT-2026-08.md` P1-21: no Sentry,
Datadog, uptime monitor, PagerDuty, or log aggregator anywhere in the codebase. The only error
visibility was `console.error`/`console.warn` writing into raw Vercel function logs — fine for one
person checking logs when something breaks, not fine once cron/webhook/generation traffic scales
across more stores and more people who won't proactively tail logs.

This runbook originally shipped Sentry (backend error capture) + a Better Stack recommendation
(uptime). Both were paid-tool paths. Dan's preference is zero-cost DIY, so both layers were replaced:
a **Telegram bot** for error notifications and a **GitHub Actions cron** for uptime checks. Same two
problems solved, $0/month, no third-party account beyond Telegram (which is free and already
something Dan uses).

---

## 1. Error notifications — Telegram bot

**Code is deployed.** `lib/notify.js` posts to a Telegram bot via plain `fetch` (no SDK, no new
dependency) with a fail-open no-op: if `TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHAT_ID` is unset,
`captureException()` does nothing and every existing deploy behaves exactly as before. Nothing
breaks until both env vars are set. `initSentry()` still exists as a no-op — kept only so the 4 call
sites below didn't need their import statements changed beyond the file path; Telegram has no init
step to run.

Wired into the same 4 entry points the Sentry version was:
- `api/system.js` — the main dispatcher (60+ actions). Every action's catch-all calls
  `captureException(err, { tags: { action } })` before the existing sanitize/console.error/response flow.
- `api/cron/detect-events.js` — the daily 08:00 UTC cron's catch-all, plus the per-store failure path
  inside the parallel `Promise.allSettled` run.
- `api/webhooks/shopify.js` — the Shopify webhook receiver's handler-error catch. A silently dropped
  `products/update` webhook means a product goes stale in TC with zero signal.
- `lib/actions/reviews-push.js` — the pathological-case guard when a review payload is still over the
  100 KB metafield cap after trimming (recoverable, but worth knowing about).

Each alert includes the error message, the first 8 lines of the stack trace, any `tags` passed in
(e.g. `action`, `topic`, `shop`), the Vercel environment, and a timestamp.

### Setup (5 minutes)

1. **Create the bot**: message [@BotFather](https://t.me/BotFather) on Telegram → `/newbot` → follow
   the prompts (name, username) → BotFather replies with a token like
   `123456789:AAExampleTokenNotReal`. Save it.
2. **Message the bot**: search for the bot's username in Telegram and send it any message (e.g.
   "hi") — a bot can't message you first, it needs at least one inbound message to know who you are.
3. **Get your chat ID**: open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser (replace `<TOKEN>` with the token
   from step 1). Find `"chat":{"id": ...}` in the JSON response — that number (can be negative for
   group chats) is `TELEGRAM_CHAT_ID`.
4. **Vercel env vars**: Vercel dashboard → titan-commerce project → Settings → Environment Variables
   → add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` → redeploy (env var changes need a redeploy to
   take effect in serverless functions).
5. **GitHub repo secrets** (for the uptime workflow, see below): Settings → Secrets and variables →
   Actions → New repository secret → add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` with the same
   values.

### What you get

- A Telegram message for every unhandled action/cron/webhook error, with the `action` (or
  `topic`/`shop` for webhooks) as a tag in the message text.
- Delivered to whatever chat `TELEGRAM_CHAT_ID` points at — a DM to yourself, or a group chat if you
  want the whole team to see alerts.

### Testing

Manually trigger a Telegram message without touching app code:

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/sendMessage" \
  -d "chat_id=<CHAT_ID>&text=test"
```

If that lands in the chat, the bot + chat ID are correctly configured. To test the actual
`captureException()` path, trigger any action error in the dashboard (or wait for a real one) once
`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` are set in Vercel and redeployed.

### Tradeoffs (deliberate, documented)

- **No rate limiting** — Telegram allows ~30 msg/sec per chat; Titan's error volume is far below
  that, so none was added.
- **No deduplication** — 10 occurrences of the same error send 10 Telegram messages. If a bug starts
  firing on every request, expect a flood until it's fixed or the env vars are unset. Acceptable at
  current traffic; revisit (e.g. in-memory or Supabase-backed dedup window) if it becomes noisy.
- **No aggregation dashboard** — no issue grouping, no trend view, no "seen 47 times over 3 days"
  like Sentry gave you. Just a stream of Telegram messages. Fine for current scale (3-6 stores, one
  or two people watching the chat).

---

## 2. Uptime monitor — is the app even up

Telegram alerts from `captureException()` only fire when code *runs and throws*. They say nothing if
Vercel itself is down, DNS breaks, or the app hangs. That needs a separate synthetic check hitting
the URL from outside — this is what a GitHub Actions cron does now, replacing the Better Stack
recommendation.

**Code is deployed.** `.github/workflows/uptime.yml` runs on a `*/5 * * * *` schedule (plus a manual
`workflow_dispatch` trigger) and does one thing: `curl` the health endpoint, and if it doesn't return
`200`, send a Telegram alert using the same bot as the error notifications above (via GitHub repo
secrets, not Vercel env vars — GitHub Actions runs outside Vercel).

### URL monitored

| URL | What it proves |
|---|---|
| `https://titan-commerce.vercel.app/api/system?action=health` | Backend function is up and responding. Public, unauthenticated (`lib/actions/health.js`, `?action=health` in `PUBLIC_ACTIONS`). Returns `{ ok: true, ts, ver }`. |

The workflow only checks this one URL for now (matches the original Sentry-era doc's "start with the
unauthenticated check" guidance). The frontend-bundle check (`/`) and the deeper authenticated
`stores_list` check described in the original version of this runbook were never actually set up in
Better Stack either — if either becomes worth having, add a second `curl` step to the same workflow
file rather than a second workflow (keeps the one Telegram-alert step shared).

### Interval caveat — read this before assuming 5-minute precision

GitHub Actions' `schedule` trigger is **best-effort, not real-time**. GitHub's own docs state that
scheduled workflows can be delayed, and in practice a `*/5 * * * *` cron often actually fires
5-15 minutes late during periods of high platform load (this is a known, widely-reported GitHub
Actions limitation, not something specific to this repo). Treat this as "we'll know within roughly
15-20 minutes if the app is down," not a real-time SLA monitor. That's a materially worse guarantee
than Better Stack's paid 3-min-interval checks, and it's the tradeoff being made for $0/month.

### No cooldown / no consecutive-failure threshold

Unlike the original Better Stack guidance (2 consecutive failures before alerting, to avoid a single
slow cold start triggering a false alarm), this workflow alerts on **every** failed run. A sustained
outage sends a fresh Telegram message every ~5-15 minutes until the endpoint recovers — noisy, but
guaranteed not to suppress a real outage.

**Follow-up TODO** (not built): add "only alert after 2 consecutive failures" logic. This needs the
workflow to read its own previous run's outcome — e.g. a small state file committed by the workflow,
or a call to the GitHub Actions API to check the last run's conclusion — which is more moving parts
than a single `curl` + `if`. Worth doing once false-positive noise from transient blips actually
becomes a problem in practice.

### Setup (2 minutes, on top of the Telegram bot setup above)

1. Complete steps 1-3 in the Error notifications section above (create the bot, message it, get the
   chat ID) if not already done — the uptime workflow reuses the same bot.
2. GitHub repo → Settings → Secrets and variables → Actions → New repository secret:
   - `TELEGRAM_BOT_TOKEN` = same token as the Vercel env var
   - `TELEGRAM_CHAT_ID` = same chat ID as the Vercel env var
3. Done — the workflow is already committed and will start running on its schedule. No further
   action needed.

### Testing

- **Manual run**: GitHub repo → Actions tab → "Uptime monitor" workflow → "Run workflow" button
  (this is the `workflow_dispatch` trigger) → confirm it goes green.
- **Force a failure** (optional, to confirm the Telegram alert path actually works end to end): the
  workflow will naturally fail if the health endpoint is ever down for a real deploy issue — no need
  to manufacture a fake failure in the URL itself. If you want to verify the alert wiring in
  isolation, run the two `curl` commands from the "Testing" section above (Telegram send test) — that
  confirms the bot/chat/secrets are correct without needing the endpoint to actually go down.

---

## 3. Follow-ups not done here (documented, not built)

- **Consecutive-failure threshold for the uptime workflow** — see "No cooldown" above.
- **Error deduplication in `lib/notify.js`** — see "Tradeoffs" above.
- **Second uptime check (frontend bundle `/`, or authenticated `stores_list` deep check)** — the
  original Sentry-era doc described these; neither was actually configured in Better Stack, and
  neither is in the GitHub Actions workflow now. Add a second `curl` step if a specific failure mode
  (bad Vite build, DB unreachable but process alive) turns out to be worth catching separately.
- **Real per-action alert routing** (e.g. a failed Shopify push alerting to a different chat/channel
  than a routine cron warning) — Sentry's saved-search/alert-rule feature gave this for free; Telegram
  doesn't have an equivalent without building custom routing logic in `lib/notify.js`. Not worth the
  complexity at current error volume — every alert lands in the one configured chat.

---

## Source

`Docs/AUDIT-2026-08.md` P1-21 — "No monitoring/error alerting anywhere (Sentry/Datadog/uptime)."
Sentry + Better Stack were the original P1-21 fix; this doc now reflects the Telegram + GitHub
Actions replacement (Dan's zero-cost DIY preference over paid tools).
