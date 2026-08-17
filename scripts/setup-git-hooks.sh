#!/usr/bin/env bash
# Opt-in pre-push hook: run the backend test suite before every `git push`.
#
# Not installed automatically — CI (.github/workflows/ci.yml) already catches
# a failing suite on push/PR, but that's after the push already landed on the
# remote. This hook is belt-and-suspenders for anyone who wants the same
# `npm test` gate to run locally, before the push even leaves their machine.
#
# Usage (once per clone):
#   bash scripts/setup-git-hooks.sh
#
# To skip the hook for a single push without uninstalling it:
#   git push --no-verify
#
# To remove it:
#   rm .git/hooks/pre-push

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO_ROOT" ]; then
  echo "Error: not inside a git repository." >&2
  exit 1
fi

HOOKS_DIR="$REPO_ROOT/.git/hooks"
HOOK_FILE="$HOOKS_DIR/pre-push"

mkdir -p "$HOOKS_DIR"

cat > "$HOOK_FILE" <<'HOOK'
#!/usr/bin/env bash
# Installed by scripts/setup-git-hooks.sh — runs the backend test suite
# before allowing a push. Bypass once with: git push --no-verify

echo "[pre-push] Running npm test before push..."

if ! npm test; then
  echo ""
  echo "[pre-push] npm test FAILED — push aborted."
  echo "[pre-push] Fix the failing tests, or bypass with: git push --no-verify"
  exit 1
fi

echo "[pre-push] npm test passed — proceeding with push."
HOOK

chmod +x "$HOOK_FILE"

echo "Installed pre-push hook at $HOOK_FILE"
echo "It will run 'npm test' before every 'git push' from this clone."
echo "Bypass a single push with: git push --no-verify"
