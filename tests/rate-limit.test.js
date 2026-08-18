import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase
const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom };

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupabase,
}));

// Mock Telegram escalation (C1b, AUDIT-2026-08-B) — rate-limit.js must call this on
// 42P01 (undefined_table) so a missing rate_limits table can't hide behind fail-open.
const mockCaptureException = vi.fn();
vi.mock('../lib/notify.js', () => ({
  captureException: (...args) => mockCaptureException(...args),
}));

let rateLimit;
beforeEach(async () => {
  vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  mockCaptureException.mockClear();
  vi.resetModules();
  const mod = await import('../lib/rate-limit.js');
  rateLimit = mod.rateLimit;
});

function setupMockChain(count = 0, error = null) {
  const chain = {
    delete: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockResolvedValue({ data: {}, error: null }),
    eq: vi.fn().mockReturnThis(),
    lt: vi.fn().mockResolvedValue({ data: [], error: null }),
    gte: vi.fn().mockResolvedValue({ count, error }),
  };
  mockFrom.mockReturnValue(chain);
  return chain;
}

describe('rateLimit', () => {
  it('allows request when under limit', async () => {
    setupMockChain(3);
    const result = await rateLimit('test-key', 10, 60000);
    expect(result).toBe(true);
  });

  it('blocks request when at limit', async () => {
    setupMockChain(10);
    const result = await rateLimit('test-key', 10, 60000);
    expect(result).toBe(false);
  });

  it('fails open on DB error', async () => {
    setupMockChain(0, { message: 'DB unavailable' });
    const result = await rateLimit('test-key', 10, 60000);
    expect(result).toBe(true);
  });

  it('inserts record when allowed', async () => {
    const chain = setupMockChain(0);
    await rateLimit('gen-key', 20, 3600000);
    expect(chain.insert).toHaveBeenCalledWith({ key: 'gen-key' });
  });

  it('does not insert when blocked', async () => {
    const chain = setupMockChain(20);
    await rateLimit('gen-key', 20, 3600000);
    expect(chain.insert).not.toHaveBeenCalled();
  });

  describe('42P01 missing-table escalation (C1b, AUDIT-2026-08-B)', () => {
    const missingTable = { message: 'relation "rate_limits" does not exist', code: '42P01' };

    it('escalates via captureException AND still fails open', async () => {
      setupMockChain(0, missingTable);
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await rateLimit('login_attempts:1.2.3.4', 10, 3600000);
      expect(result).toBe(true); // never block traffic on infra breakage
      expect(mockCaptureException).toHaveBeenCalledTimes(1);
      const [err, opts] = mockCaptureException.mock.calls[0];
      expect(err.message).toMatch(/rate_limits table missing/);
      expect(opts.tags.module).toBe('rate-limit');
      expect(errSpy).toHaveBeenCalledWith(
        '[rate-limit] FATAL: rate_limits table missing — limits are NO-OP'
      );
      errSpy.mockRestore();
    });

    it('sends Telegram once per module instance, logs every call', async () => {
      setupMockChain(0, missingTable);
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(await rateLimit('k1', 10, 60000)).toBe(true);
      expect(await rateLimit('k2', 10, 60000)).toBe(true);
      expect(mockCaptureException).toHaveBeenCalledTimes(1); // no Telegram flood
      expect(errSpy).toHaveBeenCalledTimes(2); // but stays loud in logs
      errSpy.mockRestore();
    });

    it('does NOT escalate ordinary DB errors', async () => {
      setupMockChain(0, { message: 'DB unavailable', code: 'PGRST000' });
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(await rateLimit('k', 10, 60000)).toBe(true);
      expect(mockCaptureException).not.toHaveBeenCalled();
      errSpy.mockRestore();
    });
  });
});
