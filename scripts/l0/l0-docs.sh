#!/usr/bin/env bash
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SELF_DIR/../.." && pwd)"
ROOT="${VC_ROOT:-$(dirname "$REPO_DIR")}"
cd "$ROOT/repo" || exit 66
git fetch origin --prune -q
BR=$(git rev-parse --abbrev-ref HEAD)
echo "BRANCH=$BR"
echo "HEAD=$(git rev-parse HEAD)"
echo "ORIGIN_INTEG=$(git rev-parse origin/integration/mc-20260916)"
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/integration/mc-20260916)" ]; then
  echo HEAD_NOT_AT_INTEGRATION
  exit 64
fi
mkdir -p scripts/l0
for f in bootstrap2.sh merge-check.sh full-gate.sh main-merge.sh l0-docs.sh; do
  [ -f "$ROOT/$f" ] && cp "$ROOT/$f" "scripts/l0/$f"
done
cat >> docs/orchestration/decisions.md <<'EOF'
- D-031 Prettier はファイル種別ごとの overrides を持つ。useTabs: true を全体適用すると JSON/MD/YAML が崩れ、未整形が 29 から 40 件に増えたため、*.json *.md *.yml *.yaml *.html は useTabs: false。prettier --check は必須ゲートにしない。
- D-032 tests/bench/ の所有者は L1-D（client/QA）。当初の所有パス表に記載が無く無所有だったため、E2E と同じ担当に寄せる。
- D-033 main への反映は integration/mc-20260916 から PR を作成し、フルゲート緑を確認してから merge commit でマージする（PR #1、main = f0ab5f0）。直接 push はしない。
- D-034 apps/game の暫定実装（localWorld.ts の地形フィクスチャ、store.ts の localStorage ダブル）は統合後に feat/mc-20260916/wire-a で実パッケージへ差し替え、その時点で bench を再ベースライン化する。
- D-035 独立レビューの成果物は docs/reviews/<reviewer>.md。レビュアーはソースを変更せず、自分のブランチ（review/rev1 / review/rev2）にレポートのみを push する。
- D-036 L0 のヘルパースクリプトは scripts/l0/ にコミットする。env 失効でランナー上のスクリプトが消え、作り直しが発生したため、永続状態は GitHub のみを真実とする方針を徹底する。
EOF
git add README.md docs/orchestration/decisions.md scripts/l0
git status --short | head -20
git commit -q -m "docs: complete README (controls, architecture, reproduction), record D-031..D-036, vendor L0 helper scripts" || { echo COMMIT_FAILED; exit 65; }
echo "COMMIT=$(git rev-parse HEAD)"
pnpm -r exec tsc --noEmit >"$ROOT/logs/docs-tsc.log" 2>&1; echo "RC tsc=$?"
pnpm -r lint >"$ROOT/logs/docs-lint.log" 2>&1; echo "RC lint=$?"
if git push -q origin HEAD:refs/heads/integration/mc-20260916 >"$ROOT/logs/docs-push.log" 2>&1; then
  echo "PUSHED=$(git rev-parse HEAD)"
else
  echo PUSH_FAILED
  tail -n 5 "$ROOT/logs/docs-push.log"
fi
echo L0_DOCS_DONE
