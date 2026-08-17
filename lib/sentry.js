import * as Sentry from '@sentry/node';

// Backend error monitoring (P1-21, AUDIT-2026-08). Fail-open by design: if SENTRY_DSN
// is unset, every export here is a no-op — existing console.error-only behavior is
// unchanged and no deploy breaks because Dan hasn't opted in yet. Uses @sentry/node
// (not @sentry/nextjs / @sentry/browser — this is a plain Vercel Node.js function
// runtime, not a Next.js app). tracesSampleRate: 0 — error-only reporting, no
// performance tracing (rate-limit friendly on the free tier).
//
// Each Vercel serverless function is its own isolated process, so this is imported
// and initSentry() is called at module top in every entry point that wants coverage
// (api/system.js, api/cron/detect-events.js, api/webhooks/shopify.js) rather than
// once globally.

let initialized = false;

export function initSentry() {
  if (initialized) return;
  initialized = true; // set before the init attempt — never retry init on every request
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return; // no-op until Dan sets SENTRY_DSN
  try {
    Sentry.init({
      dsn,
      tracesSampleRate: 0,
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'production',
      release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
    });
  } catch (err) {
    // Sentry itself must never break the app — log and continue uninstrumented.
    console.error('[Sentry] init failed, continuing without error reporting:', err.message);
  }
}

export function captureException(err, context) {
  if (!process.env.SENTRY_DSN) return; // fail-open no-op
  try {
    Sentry.captureException(err, context);
  } catch (captureErr) {
    console.error('[Sentry] captureException failed:', captureErr.message);
  }
}
