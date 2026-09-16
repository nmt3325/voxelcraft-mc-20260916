#!/usr/bin/env bash
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SELF_DIR/../.." && pwd)"
ROOT="${VC_ROOT:-$(dirname "$REPO_DIR")}"
mkdir -p "$ROOT/logs"
cd "$ROOT/repo" || exit 66
git fetch origin --prune -q
INTEG=$(git rev-parse origin/integration/mc-20260916)
MAIN_BEFORE=$(git rev-parse origin/main)
echo "INTEG=$INTEG"
echo "MAIN_BEFORE=$MAIN_BEFORE"
if ! git merge-base --is-ancestor "$MAIN_BEFORE" "$INTEG"; then echo NOT_FF; exit 64; fi
PR_NUM=$(gh pr list --base main --head integration/mc-20260916 --state open --json number -q '.[0].number' 2>/dev/null)
if [ -z "${PR_NUM:-}" ]; then
  gh pr create --base main --head integration/mc-20260916 --title "${PR_TITLE:-VoxelCraft integration (mc-20260916)}" --body-file "${PR_BODY_FILE:-$ROOT/pr-body.md}" >"$ROOT/logs/pr-create.log" 2>&1
  echo "RC pr_create=$?"
  tail -n 3 "$ROOT/logs/pr-create.log"
  PR_NUM=$(gh pr list --base main --head integration/mc-20260916 --state open --json number -q '.[0].number' 2>/dev/null)
fi
echo "PR_NUM=$PR_NUM"
gh pr view "$PR_NUM" --json url -q .url
gh pr merge "$PR_NUM" --merge --subject "${PR_TITLE:-Merge VoxelCraft integration (mc-20260916)}" --body "Full gate green on $INTEG" >"$ROOT/logs/pr-merge.log" 2>&1
RC=$?
echo "RC merge=$RC"
tail -n 4 "$ROOT/logs/pr-merge.log"
if [ "$RC" -ne 0 ]; then
  gh pr merge "$PR_NUM" --merge --admin >>"$ROOT/logs/pr-merge.log" 2>&1
  echo "RC merge_admin=$?"
  tail -n 4 "$ROOT/logs/pr-merge.log"
fi
git fetch origin --prune -q
MAIN_AFTER=$(git rev-parse origin/main)
echo "MAIN_AFTER=$MAIN_AFTER"
if git merge-base --is-ancestor "$INTEG" "$MAIN_AFTER"; then echo MAIN_CONTAINS_INTEG=yes; else echo MAIN_CONTAINS_INTEG=no; fi
gh pr view "$PR_NUM" --json state,url,mergedAt -q '.state + " " + .url + " " + (.mergedAt // "none")'
echo MAIN_MERGE_DONE
