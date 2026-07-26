import { useUser } from '../hooks/useUser.jsx';

// Client-side mirror of lib/permissions.js hasPermission — cosmetic UI gating ONLY.
// The real enforcement is server-side (every lib/actions/* checks hasPermission()
// again); this component just avoids showing controls the user can't use.
function hasPermission(user, perm) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return Array.isArray(user.permissions) && user.permissions.includes(perm);
}

export default function PermissionGate({ perm, fallback = null, children }) {
  const { user } = useUser();
  return hasPermission(user, perm) ? children : fallback;
}
