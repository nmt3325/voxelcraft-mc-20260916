# VoxelCraft v1 全体計画 (RUN_LABEL: mc-20260916)

- リポジトリ: https://github.com/nmt3325/voxelcraft-mc-20260916 (public)
- 統合ブランチ: `integration/mc-20260916` / 既定ブランチ: `main`（直接 push は L0 のみ）
- 共有契約: `packages/core-types` `CONTRACT_VERSION = '1.0.0'`。このコミットの SHA が `CONTRACT_SHA`。
- 期限: 2026-09-17 19:00 JST。時間不足時は v2 を切り、v1 完了条件を優先する。

## 1. 不変ルール（全階層）

1. コード生成・編集・ビルド・テスト・ネットワークは **gha mcp のランナー env のみ**。`connections.computer` は使わない。
2. 永続状態は **GitHub リモートのみ**が真実。**15分ごと、およびチェックがグリーンになる度に push**。env はいつ消えてもよい状態を保つ。
3. `packages/core-types/**`・`docs/orchestration/**`・ルート設定・CI・`package.json` の依存宣言は **L0 専有**。変更が必要なら実装を止めて `status: blocked` + `contract_changes_needed` で親へ報告する。
4. 依存パッケージの追加・バージョン変更は禁止（ルート `package.json` で L0 が一括管理済み）。必要なら `contract_changes_needed`。
5. 所有パス外は編集しない（自分のレポート `docs/reports/<taskid>.json` とログ出力先を除く）。
6. `main` への直接 push、未検証の `done` 報告、他タスクのブランチ・レポート・共有 git 設定の変更は禁止。
7. `env_create` / `env_extend` / `env_destroy` / `git worktree add|remove|prune` / 他人のジョブ停止は L0 のみ。子は指定された env と作業ツリーだけを使う。

## 2. タスク割り当て

| taskid | 階層 | env_id | 作業ツリー | ブランチ | 所有パス |
| --- | --- | --- | --- | --- | --- |
| world-a | L1-A | linux-2pbedvae | `.../linux-2pbedvae/work/vc/repo` | `feat/mc-20260916/world-a` | `packages/world/**` |
| world-b | L2 | linux-2pbedvae | `.../linux-2pbedvae/work/vc/wt/world-b` | `feat/mc-20260916/world-b` | `packages/world/**`（L1-A が割当） |
| world-c | L2 | linux-2pbedvae | `.../linux-2pbedvae/work/vc/wt/world-c` | `feat/mc-20260916/world-c` | `packages/world/**`（L1-A が割当） |
| sim-a | L1-B | linux-dcamy0xn | `.../linux-dcamy0xn/work/vc/repo` | `feat/mc-20260916/sim-a` | `packages/sim/**` |
| sim-b | L2 | linux-dcamy0xn | `.../linux-dcamy0xn/work/vc/wt/sim-b` | `feat/mc-20260916/sim-b` | `packages/sim/**` |
| sim-c | L2 | linux-dcamy0xn | `.../linux-dcamy0xn/work/vc/wt/sim-c` | `feat/mc-20260916/sim-c` | `packages/sim/**` |
| gameplay-a | L1-C | linux-0jtv23c8 | `.../linux-0jtv23c8/work/vc/repo` | `feat/mc-20260916/gameplay-a` | `packages/gameplay/**` |
| gameplay-b | L2 | linux-0jtv23c8 | `.../linux-0jtv23c8/work/vc/wt/gameplay-b` | `feat/mc-20260916/gameplay-b` | `packages/gameplay/**` |
| gameplay-c | L2 | linux-0jtv23c8 | `.../linux-0jtv23c8/work/vc/wt/gameplay-c` | `feat/mc-20260916/gameplay-c` | `packages/gameplay/**` |
| client-a | L1-D | linux-0hnn8qdt | `.../linux-0hnn8qdt/work/vc/repo` | `feat/mc-20260916/client-a` | `packages/client/**`, `apps/game/**` |
| client-b | L2 | linux-0hnn8qdt | `.../linux-0hnn8qdt/work/vc/wt/client-b` | `feat/mc-20260916/client-b` | `packages/assets-gen/**` ほか L1-D 割当 |
| client-c | L2 | linux-0hnn8qdt | `.../linux-0hnn8qdt/work/vc/wt/client-c` | `feat/mc-20260916/client-c` | `tests/e2e/**` ほか L1-D 割当 |

- パス重複は禁止。サブツリー内の細分（例: `packages/world/src/noise/**` を world-b、`.../structures/**` を world-c）は L1 が決めて自分のプロンプトで明示する。
- L2 は自分の worktree で `git commit` / `git push`（自分のブランチのみ）。L1 は完了後に `-b` `-c` を自分の `-a` へ `merge --no-ff` する。
- L3 は L2 が必要に応じて起動（Mob 1種、テクスチャ1系統、テスト作成、レビュー専任など）。最大深さ L3。

## 3. サブツリー別 受入条件

### L1-A world (`packages/world`)
- `createWorldGenerator(seed)` が `WorldGenerator` を満たす。3Dノイズ洞窟・深度依存鉱石・6バイオーム・樹木植生・海面 62・岩盤 4層。
- 決定論: 同一シードで `generateChunk` の結果がバイト一致。生成順（正順/逆順/4並列）で不変。`Math.random`/`Date.now`/`Math.sin` 不使用（`core-types` の `hashU32`/`hash01`/`makeRng` のみ）。
- 必須テスト: 黄金ハッシュ（`hashBuffer`）、順序不変、バイオーム分布、鉱石深度分布、洞窟が地表を破壊しすぎないこと。
- 目安 L2 分割: (b) ノイズ/気候/高度マップ、(c) 洞窟・鉱石・構造物/植生。

### L1-B sim (`packages/sim`)
- ECS（`EcsWorld` 実装）、20Hz 固定 tick、`SYSTEM_ORDER` 準拠。AABB 衝突（Y→X→Z、サブステップ 0.45）、歩行/走り/忍び足/ジャンプ/水泳/落下ダメージ、`raycastVoxels`（Amanatides & Woo）。
- 光伝播: 空光＋ブロック光の BFS、差分更新（設置・破壊時の除去伝播）、チャンク跨ぎ stitch。流体: 水・溶岩の流動と相互作用（水+溶岩→石/黒曜石）。
- Mob: 受動4種・敵性4種、明度依存スポーン、A* 経路探索（`PATHFIND` 予算内）、AI 状態機械、戦闘・ノックバック・矢。
- 必須テスト: 非貫通 1000tick、静止安定、段差 0.5/1.0 可・1.5 不可、DDA 不変条件、光伝播（設置/破壊/斜め/跨ぎ）、A* 最適性（小規模 Dijkstra 比較）、リプレイ決定論。
- 目安 L2 分割: (b) 光＋流体、(c) Mob AI＋戦闘＋経路探索。

### L1-C gameplay (`packages/gameplay`)
- ブロック/アイテム定義レジストリ（`core-types` の `BLOCK`/`ITEM` id を使用）、36スロット＋ホットバー、2x2/3x3 クラフト（シフト不変一致）、かまど精錬、耐久・スタック、サバイバル/クリエイティブ。
- ブロックエンティティ（チェスト/かまど/作業台/ドア/ベッド＝リスポーン地点）、簡易レッドストーン（粉伝播/レバー/ボタン/感圧板/ドア連動/ピストン）。
- 永続化: `ChunkCodec`（`chunk.ts` のヘッダ仕様どおり）と `WorldStore`（IndexedDB 実装 + Node 用 FS/メモリアダプタ）。
- 必須テスト: レシピ解決（シフト不変・不一致）、精錬、耐久消費、直列化ラウンドトリップ（パレット境界 1/2/3/16/17/256/257 を含む）、レッドストーン伝播、ベッドリスポーン。
- 目安 L2 分割: (b) インベントリ/クラフト/かまど、(c) 直列化/永続化/レッドストーン。

### L1-D client/QA (`packages/client`, `packages/assets-gen`, `apps/game`, `tests/e2e`)
- greedy meshing を Web Worker で実行（`MesherMessage`/`MeshResult`、頂点は Uint16 x8 インターリーブ）、テクスチャアトラス（`assets-gen` が手続き生成、GPU では配列テクスチャ層として使用）、AO、視錐台カリング、描画距離設定、昼夜サイクル、水中演出。
- HUD・インベントリ画面・ポーズ・ワールド作成/選択・設定（描画距離/FOV/感度）・F3相当デバッグ・効果音（`assets-gen` が WAV を手続き生成）。
- E2E（Playwright, SwiftShader）: 固定シード起動 → 破壊 → 設置 → 保存 → 再読込で同一状態 → スクリーンショット、**console error ゼロ**。`tests/bench` で描画距離8相当の生成＋メッシュ化と 1tick 平均を計測しログ化。
- 必須テスト: メッシャ決定論（同入力でバイト一致）、面数不変条件（`Σ(w*h) == 可視面数`）、単一ボクセル = 6 quad / 24 頂点、AO 範囲と回転、レイヤ分離、アトラス再生成の決定論。
- 目安 L2 分割: (b) `assets-gen`（テクスチャ・音）、(c) `tests/e2e` + bench + UI。
- Worker の型: `packages/client` 内に自前の `worker-env.d.ts` を置き、`self`/`postMessage` を DOM 型と衝突させない。`new Worker(new URL('./mesher.worker.ts', import.meta.url), { type: 'module' })` を静的に書く（動的組み立ては Vite が解決できない）。`SharedArrayBuffer` は必須にしない（`crossOriginIsolated` を feature-detect）。

## 4. 検証コマンド（全階層共通・exit code で判定）

```
pnpm -r exec tsc --noEmit
pnpm -r lint
pnpm -r test
pnpm build          # dist は repo ルート、gzip サイズは pnpm size で報告
pnpm size
pnpm test:e2e       # client サブツリーと L0 のみ
pnpm bench
```

- 依存が未導入の env では `bash scripts/bootstrap-env.sh <branch>` を先に実行。
- 1 env の同時重ビルドは最大2本。L1 が枠を割り当てる。

## 5. レポート（必須）

`docs/reports/<taskid>.json` を自分のブランチにコミットする。

```json
{
  "task": "world-a",
  "branch": "feat/mc-20260916/world-a",
  "status": "done",
  "base_sha": "<CONTRACT_SHA>",
  "head_sha": "<最新コミット>",
  "commits": ["..."],
  "files_changed": ["packages/world/src/..."],
  "checks": [
    { "name": "tsc", "command": "pnpm -r exec tsc --noEmit", "job_id": "...", "state": "exited", "exit_code": 0, "eof": true, "log": "logs/tsc.log" }
  ],
  "contract_changes_needed": [],
  "notes": "..."
}
```

- `status` は `in_progress` / `done` / `blocked` / `failed`。**実装コミットが無い報告は差し戻し。**
- 詰まったら30分以内に `blocked` で親へ報告（ユーザーを待たない）。

## 6. gha mcp 実測ツール名（スキルの記載と異なる。こちらが正）

- 使えるのは `env_status` / `env_list` / `execute` / `start_command` / `poll_job` / `stop_job` / `read_file` / `write_file` / `list_directory` / `get_image`。
- `exec` / `exec_read` / `exec_kill` / `file_read` / `file_write(content_b64)` / `command_id` / `deadline_ms` は**存在しない**。
- `command` は argv 配列。長いシェル処理は `["bash","-lc","..."]`。毎回 `cwd` を絶対パスで渡す。
- 完了判定は `state: "exited"` かつ `exit_code` かつ `eof: true`。`returned_because` が `idle`/`deadline`/`queued` は未完了。`poll_job` で `from_byte` を進めて全出力を回収する。
- `stop_job` の `all` は禁止。他人のジョブを止めない。

## 7. 停止条件と完了トークン

- 契約変更が必要 / 所有パス外の修正が必要 / 30分以上進まない → その時点で push し、`blocked` レポートを書いて親に報告。
- 自分の担当がすべてグリーン（上記コマンドが exit 0）かつ push 済み かつレポート提出済みのときのみ、完了トークンを1行で出力する。
  - L1-A: `WORLD_A_DONE` / L1-B: `SIM_A_DONE` / L1-C: `GAMEPLAY_A_DONE` / L1-D: `CLIENT_A_DONE`
  - L2 は `<TASKID_UPPER>_DONE`（例: `WORLD_B_DONE`）。
