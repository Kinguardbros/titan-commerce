// Closed permission set — validated on create_user/update_user (lib/actions/users.js).
// role='admin' implicitly grants ALL permissions + ALL store access; explicit
// permissions/store_access on an admin row are ignored (admin trumps).
export const PERMISSION_LIST = [
  'products:read',
  'products:edit',
  'products:images',
  'products:publications',
  'creatives:generate',
  'admin:users',
];

export const ADMIN_ROLE = 'admin';

/**
 * @param {{role?: string, permissions?: string[], master?: boolean}|null} user
 * @param {string} perm
 * @returns {boolean}
 */
export function hasPermission(user, perm) {
  if (!user) return false;
  if (user.role === ADMIN_ROLE) return true;
  return Array.isArray(user.permissions) && user.permissions.includes(perm);
}

/**
 * @param {{role?: string, store_access?: string[], master?: boolean}|null} user
 * @param {string} storeId
 * @returns {boolean}
 */
export function hasStoreAccess(user, storeId) {
  if (!user) return false;
  if (user.role === ADMIN_ROLE) return true;
  return Array.isArray(user.store_access) && user.store_access.includes(storeId);
}
