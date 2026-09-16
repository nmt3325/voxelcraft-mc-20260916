#!/usr/bin/env bash
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SELF_DIR/../.." && pwd)"
ROOT="${VC_ROOT:-$(dirname "$REPO_DIR")}"
INTEG=integration/mc-20260916
B="${1:-}"
MODE="${2:---push}"
[ -n "$B" ] || { echo "usage: merge-check.sh <branch> [--dry|--push]"; exit 64; }
cd "$ROOT/repo" || exit 66
mkdir -p "$ROOT/logs"
SLUG=$(echo "$B" | tr '/' '-')
LOG="$ROOT/logs/merge-$SLUG.log"
: >"$LOG"
git fetch origin --prune -q
git checkout -q -B l0-integ "origin/$INTEG" || exit 67
git reset --hard -q "origin/$INTEG"
echo "INTEG_BEFORE=$(git rev-parse HEAD)"
git rev-parse --verify -q "origin/$B" >/dev/null || { echo BRANCH_MISSING; exit 67; }
echo "FEATURE_HEAD=$(git rev-parse "origin/$B")"
echo "FEATURE_COMMITS=$(git rev-list --count "origin/$INTEG..origin/$B")"
if ! git merge --no-ff --no-edit "origin/$B" >>"$LOG" 2>&1; then
  echo MERGE_CONFLICT
  git diff --name-only --diff-filter=U
  git merge --abort
  exit 65
fi
echo "MERGED=$(git rev-parse HEAD)"
git diff --shortstat "origin/$INTEG..HEAD"
FAIL=0
step() {
  n="$1"; shift
  echo "=== $n ===" >>"$LOG"
  "$@" >>"$LOG" 2>&1
  rc=$?
  echo "RC $n=$rc"
  [ "$rc" -eq 0 ] || FAIL=1
}
step install pnpm install --no-frozen-lockfile
[ $FAIL -eq 0 ] && step tsc pnpm -r exec tsc --noEmit
[ $FAIL -eq 0 ] && step lint pnpm -r lint
[ $FAIL -eq 0 ] && step test pnpm -r test
[ $FAIL -eq 0 ] && step build pnpm build
[ $FAIL -eq 0 ] && step size pnpm size
[ $FAIL -eq 0 ] && step e2e pnpm test:e2e
[ $FAIL -eq 0 ] && step bench pnpm bench
grep -E 'TOTAL raw=' "$LOG" | tail -n1
if [ $FAIL -ne 0 ]; then
  echo "GATE_FAILED branch=$B log=$LOG"
  tail -n 45 "$LOG"
  git reset --hard -q "origin/$INTEG"
  exit 1
fi
echo "GATE_GREEN branch=$B sha=$(git rev-parse HEAD)"
if [ "$MODE" = "--dry" ]; then
  echo DRY_RUN_NO_PUSH
  git reset --hard -q "origin/$INTEG"
else
  if git push -q origin "HEAD:$INTEG" >>"$LOG" 2>&1; then
    echo "MERGE_PUSHED=$(git rev-parse HEAD)"
  else
    echo PUSH_FAILED
    tail -n 20 "$LOG"
    exit 68
  fi
fi
echo MERGE_CHECK_DONE
