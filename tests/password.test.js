import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../lib/password.js';

describe('hashPassword / verifyPassword', () => {
  it('round-trips: verifyPassword matches the original password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(await verifyPassword('correct-horse-battery-staple', hash)).toBe(true);
  });

  it('produces a hash in the "salt:derivedKey" format', async () => {
    const hash = await hashPassword('some-password');
    const parts = hash.split(':');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/^[a-f0-9]{32}$/); // 16-byte salt as hex
    expect(parts[1]).toMatch(/^[a-f0-9]{128}$/); // 64-byte derived key as hex
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct-password');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('produces different hashes for the same password (random salt)', async () => {
    const hash1 = await hashPassword('same-password');
    const hash2 = await hashPassword('same-password');
    expect(hash1).not.toBe(hash2);
  });

  it('handles a malformed hash gracefully (returns false, does not throw)', async () => {
    await expect(verifyPassword('any-password', 'not-a-valid-hash')).resolves.toBe(false);
  });

  it('handles an empty hash string gracefully', async () => {
    await expect(verifyPassword('any-password', '')).resolves.toBe(false);
  });
});
