#!/usr/bin/env bash
# Bootstrap a gha-mcp runner for VoxelCraft work.
#   bash scripts/bootstrap-env.sh <branch> [workdir]
# Recovers a wiped environment from the GitHub remote, which is the only source of truth.
set -euo pipefail
BRANCH="${1:?usage: bootstrap-env.sh <branch> [workdir]}"
WORKDIR="${2:-$PWD/vc}"
REPO_URL="https://github.com/nmt3325/voxelcraft-mc-20260916.git"

mkdir -p "$WORKDIR"
cd "$WORKDIR"
command -v pnpm >/dev/null 2>&1 || npm i -g pnpm@10

if [ ! -d repo/.git ]; then
  git clone "$REPO_URL" repo
fi
cd repo
git config user.name "VoxelCraft Agent"
git config user.email "nmt3325@users.noreply.github.com"
git fetch --all --prune

if git rev-parse --verify --quiet "refs/remotes/origin/$BRANCH" >/dev/null; then
  git checkout -B "$BRANCH" "origin/$BRANCH"
else
  git checkout -B "$BRANCH" origin/main
fi

pnpm install --no-frozen-lockfile
if [ -d tests/e2e ]; then pnpm exec playwright install chromium || echo PLAYWRIGHT_INSTALL_FAILED; fi
echo "BOOTSTRAP_OK repo=$PWD branch=$(git rev-parse --abbrev-ref HEAD) head=$(git rev-parse --short HEAD)"
