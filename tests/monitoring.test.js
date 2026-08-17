import { describe, it, expect, vi, beforeEach } from 'vitest';

// P1-21 (AUDIT-2026-08): health action (uptime-monitor ping target) + Sentry wrapper
// fail-open behavior. Both must work with SENTRY_DSN unset — that's the default state
// for every existing deploy until Dan opts in.

describe('health action', () => {
  it('returns ok:true with a numeric ts and a ver string, no DB/auth involved', async () => {
    const { health } = await import('../lib/actions/health.js');
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    await health({ query: {}, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.ok).toBe(true);
    expect(typeof payload.ts).toBe('number');
    expect(typeof payload.ver).toBe('string');
  });
});

describe('lib/sentry.js fail-open behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('initSentry() is a no-op and never throws when SENTRY_DSN is unset', async () => {
    const { initSentry } = await import('../lib/sentry.js');
    expect(() => initSentry()).not.toThrow();
  });

  it('captureException() is a no-op and never throws when SENTRY_DSN is unset', async () => {
    const { captureException } = await import('../lib/sentry.js');
    expect(() => captureException(new Error('test'), { tags: { action: 'test' } })).not.toThrow();
  });

  it('initSentry() calls Sentry.init when SENTRY_DSN is set', async () => {
    const initMock = vi.fn();
    vi.doMock('@sentry/node', () => ({ init: initMock, captureException: vi.fn() }));
    vi.stubEnv('SENTRY_DSN', 'https://fake@example.ingest.sentry.io/1');
    const { initSentry } = await import('../lib/sentry.js');
    initSentry();
    expect(initMock).toHaveBeenCalledOnce();
    expect(initMock.mock.calls[0][0]).toMatchObject({ dsn: 'https://fake@example.ingest.sentry.io/1', tracesSampleRate: 0 });
  });

  it('captureException() forwards to Sentry.captureException when SENTRY_DSN is set', async () => {
    const captureMock = vi.fn();
    vi.doMock('@sentry/node', () => ({ init: vi.fn(), captureException: captureMock }));
    vi.stubEnv('SENTRY_DSN', 'https://fake@example.ingest.sentry.io/1');
    const { captureException } = await import('../lib/sentry.js');
    const err = new Error('boom');
    captureException(err, { tags: { action: 'test_action' } });
    expect(captureMock).toHaveBeenCalledWith(err, { tags: { action: 'test_action' } });
  });
});
