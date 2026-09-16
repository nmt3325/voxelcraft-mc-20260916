#!/usr/bin/env bash
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SELF_DIR/../.." && pwd)"
ROOT="${VC_ROOT:-$(dirname "$REPO_DIR")}"
REPO_URL=https://github.com/nmt3325/voxelcraft-mc-20260916.git
C=83c5553aacc1115c5c2e93a0622ceb685eb813ef
mkdir -p "$ROOT/logs"
command -v pnpm >/dev/null 2>&1 || npm i -g pnpm@10 >"$ROOT/logs/pnpm-setup.log" 2>&1
echo "NODE=$(node --version) PNPM=$(pnpm --version 2>/dev/null)"
if gh auth status >/dev/null 2>&1; then
  echo "GH_USER=$(gh api user -q .login 2>/dev/null)"
  if gh auth setup-git >/dev/null 2>&1; then echo GIT_CRED=ok; else echo GIT_CRED=fail; fi
else
  echo GH_AUTH=none
fi
if [ ! -d "$ROOT/repo/.git" ]; then
  git clone -q "$REPO_URL" "$ROOT/repo" || { echo CLONE_FAILED; exit 70; }
fi
cd "$ROOT/repo" || exit 66
git config user.name voxelcraft-l0
git config user.email l0@voxelcraft.local
git fetch origin --prune -q
for b in world sim gameplay client; do
  case "$b" in
    world) OWN='^(packages/world/|docs/reports/)' ;;
    sim) OWN='^(packages/sim/|docs/reports/)' ;;
    gameplay) OWN='^(packages/gameplay/|docs/reports/)' ;;
    client) OWN='^(packages/client/|packages/assets-gen/|apps/game/|tests/e2e/|tests/bench/|docs/reports/)' ;;
  esac
  R="origin/feat/mc-20260916/$b-a"
  H=$(git rev-parse --short "$R" 2>/dev/null || echo MISSING)
  N=$(git rev-list --count "$C..$R" 2>/dev/null)
  ST=$(git show "$R:docs/reports/$b-a.json" 2>/dev/null | tr -d ' \n' | grep -o '"status":"[a-z_]*"' | head -n1)
  OUT=$(git diff --name-only "$C..$R" | grep -vE "$OWN" | tr '\n' ' ')
  PROT=$(git diff --name-only "$C..$R" | grep -E '^(packages/core-types/|docs/orchestration/|pnpm-lock\.yaml|package\.json|\.github/)' | tr '\n' ' ')
  FILES=$(git diff --name-only "$C..$R" | wc -l)
  echo "$b-a head=$H commits=$N files=$FILES report=$ST out=[${OUT:-NONE}] protected=[${PROT:-NONE}]"
done
echo "integration=$(git rev-parse --short origin/integration/mc-20260916) main=$(git rev-parse --short origin/main)"
git checkout -q -B l0-integ origin/integration/mc-20260916 || exit 67
pnpm install --no-frozen-lockfile >"$ROOT/logs/install.log" 2>&1
echo "RC install=$?"
pnpm exec playwright install chromium >"$ROOT/logs/pw.log" 2>&1
echo "RC playwright=$?"
echo BOOT2_DONE
