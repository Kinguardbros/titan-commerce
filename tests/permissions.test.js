import { describe, it, expect } from 'vitest';
import { hasPermission, hasStoreAccess, PERMISSION_LIST, ADMIN_ROLE } from '../lib/permissions.js';

describe('PERMISSION_LIST', () => {
  it('is the closed set of 6 permissions', () => {
    expect(PERMISSION_LIST).toEqual([
      'products:read',
      'products:edit',
      'products:images',
      'products:publications',
      'creatives:generate',
      'admin:users',
    ]);
  });
});

describe('ADMIN_ROLE', () => {
  it('is "admin"', () => {
    expect(ADMIN_ROLE).toBe('admin');
  });
});

describe('hasPermission', () => {
  it('returns true when member has the exact permission', () => {
    const user = { role: 'member', permissions: ['products:read', 'products:edit'] };
    expect(hasPermission(user, 'products:edit')).toBe(true);
  });

  it('returns false when member lacks the permission', () => {
    const user = { role: 'member', permissions: ['products:read'] };
    expect(hasPermission(user, 'products:edit')).toBe(false);
  });

  it('returns true for admin regardless of explicit permissions array', () => {
    const user = { role: 'admin', permissions: [] };
    expect(hasPermission(user, 'admin:users')).toBe(true);
    expect(hasPermission(user, 'products:edit')).toBe(true);
  });

  it('returns true for master fallback user', () => {
    const user = { master: true, role: 'admin' };
    expect(hasPermission(user, 'admin:users')).toBe(true);
  });

  it('returns false when user is null/undefined', () => {
    expect(hasPermission(null, 'products:read')).toBe(false);
    expect(hasPermission(undefined, 'products:read')).toBe(false);
  });

  it('returns false for an unknown permission string (no crash)', () => {
    const user = { role: 'member', permissions: ['products:read'] };
    expect(hasPermission(user, 'foo:bar')).toBe(false);
  });
});

describe('hasStoreAccess', () => {
  it('returns true when member store_access includes the store', () => {
    const user = { role: 'member', store_access: ['store-1', 'store-2'] };
    expect(hasStoreAccess(user, 'store-1')).toBe(true);
  });

  it('returns false when member store_access does not include the store', () => {
    const user = { role: 'member', store_access: ['store-1'] };
    expect(hasStoreAccess(user, 'store-2')).toBe(false);
  });

  it('returns true for admin regardless of store_access', () => {
    const user = { role: 'admin', store_access: [] };
    expect(hasStoreAccess(user, 'any-store')).toBe(true);
  });

  it('returns true for master fallback user', () => {
    const user = { master: true, role: 'admin' };
    expect(hasStoreAccess(user, 'any-store')).toBe(true);
  });

  it('returns false when store_access is empty for a member', () => {
    const user = { role: 'member', store_access: [] };
    expect(hasStoreAccess(user, 'store-1')).toBe(false);
  });

  it('returns false when user is null/undefined', () => {
    expect(hasStoreAccess(null, 'store-1')).toBe(false);
  });
});
