import { describe, it, expect } from 'vitest';
import { hasPermission, hasStoreAccess, PERMISSION_LIST, ADMIN_ROLE } from '../lib/permissions.js';

describe('PERMISSION_LIST', () => {
  it('is the closed set of 7 permissions', () => {
    expect(PERMISSION_LIST).toEqual([
      'products:read',
      'products:edit',
      'products:images',
      'products:publications',
      'creatives:generate',
      'admin:users',
      'finance:read',
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

// P0-5 (Docs/AUDIT-2026-08.md): finance:read is a separate permission tier from
// products:read — a VA/contractor with products:read (needed for the Products tab)
// must NOT automatically see Profit/Shopify-analytics/Cockpit financial data.
describe('finance:read (P0-5)', () => {
  it('returns true for admin regardless of explicit permissions array', () => {
    const user = { role: 'admin', permissions: [] };
    expect(hasPermission(user, 'finance:read')).toBe(true);
  });

  it('returns false for a member with products:read but not finance:read', () => {
    const user = { role: 'member', permissions: ['products:read'] };
    expect(hasPermission(user, 'finance:read')).toBe(false);
  });

  it('returns true for a member explicitly granted finance:read', () => {
    const user = { role: 'member', permissions: ['finance:read'] };
    expect(hasPermission(user, 'finance:read')).toBe(true);
  });

  it('products:read alone does not imply finance:read, and vice versa', () => {
    const financeOnly = { role: 'member', permissions: ['finance:read'] };
    expect(hasPermission(financeOnly, 'products:read')).toBe(false);
    const productsOnly = { role: 'member', permissions: ['products:read'] };
    expect(hasPermission(productsOnly, 'finance:read')).toBe(false);
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
