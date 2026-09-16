#!/usr/bin/env bash
# Sync origin/main into the integration branch so the promotion PR is a clean fast-forward.
# Usage: bash scripts/l0/sync-main.sh   (env: VC_ROOT)
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SELF_DIR/../.." && pwd)"
INTEG=integration/mc-20260916
cd "$REPO_DIR" || exit 66
git fetch origin --prune -q
git checkout -q -B l0-integ "origin/$INTEG" || exit 67
git reset --hard -q "origin/$INTEG"
BEFORE=$(git rev-parse HEAD)
echo "INTEG_BEFORE=$BEFORE"
echo "MAIN=$(git rev-parse origin/main)"
if git merge-base --is-ancestor origin/main HEAD; then
  echo "ALREADY_SYNCED=yes"
  echo SYNC_MAIN_DONE
  exit 0
fi
git -c user.name=voxelcraft-l0 -c user.email=l0@voxelcraft.local merge --no-ff --no-edit -m 'chore(l0): sync main into integration before promotion PR' origin/main || { echo MERGE_MAIN_CONFLICT; git merge --abort; exit 65; }
echo "TREE_BEFORE=$(git rev-parse "${BEFORE}^{tree}")"
echo "TREE_AFTER=$(git rev-parse 'HEAD^{tree}')"
git push -q origin "HEAD:$INTEG" || { echo PUSH_FAILED; exit 68; }
echo "INTEG_SYNCED=$(git rev-parse HEAD)"
echo SYNC_MAIN_DONE
