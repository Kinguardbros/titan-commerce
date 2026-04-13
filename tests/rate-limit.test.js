import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase
const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom };

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupabase,
}));

let rateLimit;
beforeEach(async () => {
  vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
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
});
