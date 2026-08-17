-- Atomic guards for last-admin protection (P1-17, AUDIT-2026-08). Prevents 2
-- concurrent admin demote/deactivate/delete calls from both passing a
-- "count > 1 active admins" check and leaving zero active admins — the old
-- lib/actions/users.js pattern did SELECT (count in JS) then UPDATE/DELETE
-- as two separate round trips with no lock between them.
--
-- Both functions FOR UPDATE-lock the target row + all other active admin
-- rows for the duration of the transaction, so a concurrent call against a
-- *different* admin blocks until the first transaction commits/rolls back —
-- the second call then re-reads the post-commit admin count and correctly
-- sees it would drop to zero.

-- safe_update_user: atomically apply the requested update ONLY if it
-- doesn't drop active-admin count to zero. Raises exception if it would.
-- Returns the updated row on success.
CREATE OR REPLACE FUNCTION safe_update_user(
  p_user_id UUID,
  p_updates JSONB
)
RETURNS SETOF users AS $$
DECLARE
  v_current users;
  v_new_role TEXT;
  v_new_active BOOLEAN;
  v_would_lose_last_admin BOOLEAN;
BEGIN
  -- Lock the target row for the duration of this transaction. FOR UPDATE
  -- prevents a concurrent update on the SAME row from racing past us; the
  -- SELECT below on other admins provides the cross-row serialization.
  SELECT * INTO v_current FROM users WHERE id = p_user_id FOR UPDATE;
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;

  -- Determine post-update role/active — coalesce with current if not in updates.
  v_new_role := COALESCE(p_updates->>'role', v_current.role);
  v_new_active := COALESCE((p_updates->>'active')::boolean, v_current.active);

  -- Would this leave zero active admins?
  IF v_current.role = 'admin' AND v_current.active = true
     AND (v_new_role != 'admin' OR v_new_active = false) THEN
    SELECT COUNT(*) = 0 INTO v_would_lose_last_admin
      FROM users
      WHERE role = 'admin' AND active = true AND id != p_user_id
      FOR UPDATE;
    IF v_would_lose_last_admin THEN
      RAISE EXCEPTION 'last_active_admin';
    END IF;
  END IF;

  -- Apply the update. Note: raw JSONB → column mapping — only fields present
  -- in p_updates get updated. This matches the JS-side buildUpdates logic.
  RETURN QUERY
    UPDATE users SET
      role = COALESCE(p_updates->>'role', role),
      active = COALESCE((p_updates->>'active')::boolean, active),
      permissions = COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_updates->'permissions')), permissions),
      store_access = COALESCE(ARRAY(SELECT (jsonb_array_elements_text(p_updates->'store_access'))::uuid), store_access),
      full_name = COALESCE(p_updates->>'full_name', full_name),
      email = COALESCE(p_updates->>'email', email)
    WHERE id = p_user_id
    RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- safe_delete_user: atomically delete a user only if it doesn't drop
-- active-admin count to zero.
CREATE OR REPLACE FUNCTION safe_delete_user(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_current users;
  v_would_lose_last_admin BOOLEAN;
BEGIN
  SELECT * INTO v_current FROM users WHERE id = p_user_id FOR UPDATE;
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;

  IF v_current.role = 'admin' AND v_current.active = true THEN
    SELECT COUNT(*) = 0 INTO v_would_lose_last_admin
      FROM users
      WHERE role = 'admin' AND active = true AND id != p_user_id
      FOR UPDATE;
    IF v_would_lose_last_admin THEN
      RAISE EXCEPTION 'last_active_admin';
    END IF;
  END IF;

  DELETE FROM users WHERE id = p_user_id;
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION safe_update_user(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION safe_delete_user(UUID) FROM PUBLIC;
-- Backend uses service_role which bypasses these grants; explicit revoke is
-- defense-in-depth against future misconfigured PostgREST exposure.
