#!/usr/bin/env bash
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SELF_DIR/../.." && pwd)"
ROOT="${VC_ROOT:-$(dirname "$REPO_DIR")}"
REF="${1:-integration/mc-20260916}"
cd "$ROOT/repo" || exit 66
mkdir -p "$ROOT/logs"
SLUG=$(echo "$REF" | tr '/' '-')
LOG="$ROOT/logs/gate-$SLUG.log"
: >"$LOG"
git fetch origin --prune -q
git checkout -q -B l0-gate "origin/$REF" 2>/dev/null || git checkout -q -B l0-gate "$REF" || exit 67
echo "GATE_REF=$REF"
echo "GATE_SHA=$(git rev-parse HEAD)"
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
[ $FAIL -eq 0 ] && step lint_root pnpm lint
[ $FAIL -eq 0 ] && step test pnpm -r test
[ $FAIL -eq 0 ] && step build pnpm build
[ $FAIL -eq 0 ] && step size pnpm size
[ $FAIL -eq 0 ] && step e2e pnpm test:e2e
[ $FAIL -eq 0 ] && step bench pnpm bench
grep -E 'TOTAL raw=' "$LOG" | tail -n1
grep -iE 'chunkgen|chunkmesh|simtick|sectionmesh' "$LOG" | tail -n8
if [ $FAIL -ne 0 ]; then
  echo "GATE_RESULT=RED log=$LOG"
  tail -n 45 "$LOG"
  exit 1
fi
echo "GATE_RESULT=GREEN log=$LOG"
echo FULL_GATE_DONE
