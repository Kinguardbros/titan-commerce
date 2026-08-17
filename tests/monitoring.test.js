import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// P1-21 follow-up: health action (uptime-monitor ping target, unchanged) + the
// Telegram-based lib/notify.js that replaced lib/sentry.js. Both must work with
// TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID unset — that's the default state for every
// existing deploy until Dan opts in (fail-open by design).

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

describe('lib/notify.js — Telegram error notifications, fail-open behavior', () => {
  let fetchMock;

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('initSentry() is a no-op and never throws (no init step needed for Telegram)', async () => {
    const { initSentry } = await import('../lib/notify.js');
    expect(() => initSentry()).not.toThrow();
  });

  it('captureException() never throws and does not call fetch when TELEGRAM_BOT_TOKEN/CHAT_ID are unset', async () => {
    const { captureException } = await import('../lib/notify.js');
    await expect(captureException(new Error('test'), { tags: { action: 'test' } })).resolves.not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('captureException() never throws when only one of the two env vars is set', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'fake-token');
    vi.stubEnv('TELEGRAM_CHAT_ID', '');
    const { captureException } = await import('../lib/notify.js');
    await expect(captureException(new Error('test'))).resolves.not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('captureException() POSTs to the Telegram sendMessage endpoint with error message + action tag when both env vars are set', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'fake-token-123');
    vi.stubEnv('TELEGRAM_CHAT_ID', '-100987654');
    const { captureException } = await import('../lib/notify.js');

    const err = new Error('boom');
    await captureException(err, { tags: { action: 'test_action' } });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/botfake-token-123/sendMessage');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(opts.body);
    expect(body.chat_id).toBe('-100987654');
    expect(body.parse_mode).toBe('Markdown');
    expect(body.text).toContain('boom');
    expect(body.text).toContain('test_action');
  });

  it('captureException() includes the stack trace (truncated) when present', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'fake-token');
    vi.stubEnv('TELEGRAM_CHAT_ID', '123');
    const { captureException } = await import('../lib/notify.js');

    const err = new Error('with stack');
    await captureException(err, { tags: { action: 'stack_test' } });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toContain('with stack');
    // First line of a real Error stack is "Error: <message>"
    expect(body.text).toMatch(/```/);
  });

  it('captureException() truncates text to Telegram\'s 4096 char limit with headroom', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'fake-token');
    vi.stubEnv('TELEGRAM_CHAT_ID', '123');
    const { captureException } = await import('../lib/notify.js');

    const err = new Error('x'.repeat(10_000));
    await captureException(err, { tags: { action: 'long' } });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text.length).toBeLessThanOrEqual(4000);
  });

  it('captureException() logs and does not throw when the Telegram API responds non-ok', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'fake-token');
    vi.stubEnv('TELEGRAM_CHAT_ID', '123');
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized' });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { captureException } = await import('../lib/notify.js');
    await expect(captureException(new Error('boom'), { tags: { action: 'x' } })).resolves.not.toThrow();
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('captureException() logs and does not throw when fetch itself rejects (network error)', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'fake-token');
    vi.stubEnv('TELEGRAM_CHAT_ID', '123');
    fetchMock.mockRejectedValue(new Error('network down'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { captureException } = await import('../lib/notify.js');
    await expect(captureException(new Error('boom'), { tags: { action: 'x' } })).resolves.not.toThrow();
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
