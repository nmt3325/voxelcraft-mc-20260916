# Decisions log - mc-20260916

L0 records every judgement call here so children never have to guess.

| ID | Decision | Rationale |
| --- | --- | --- |
| D-001 | Repository is `nmt3325/voxelcraft-mc-20260916`, public. | User-approved. The runner's `gh` is authenticated as `nmt3325`, so the push-capable identity owns the repo. |
| D-002 | The GitHub remote is the only source of truth; runner state is disposable. | Runner leases expire (<=330 min), so every agent pushes at least every 15 minutes and after each green check. |
| D-003 | Cross-package imports resolve through `package.json` `exports` pointing at `src/index.ts`; no build step between workspace packages, no TS project references, no deep imports. | Keeps `pnpm -r exec tsc --noEmit`, vitest and Vite on one resolution path with zero build ordering. |
| D-004 | Third-party dependencies are declared **only** in the root `package.json` (L0-owned). Packages declare workspace deps only. | One lockfile owner prevents `pnpm-lock.yaml` merge conflicts across four parallel branches. A child needing a new dep reports `contract_changes_needed`. |
| D-005 | `noUncheckedIndexedAccess` and `noUnusedLocals`/`noUnusedParameters` are off; unused vars are an ESLint warning. | Voxel code is index-heavy; the gate is exit code 0, and these settings would generate churn without catching real bugs. |
| D-006 | TS `lib` is `ES2022, DOM, DOM.Iterable`. Worker globals are declared locally in the owning package. | Mixing `DOM` and `WebWorker` libs produces duplicate-declaration errors. |
| D-007 | `pnpm build` writes to the repository-root `dist/`, via `apps/game` Vite config. | The completion criteria name `dist` explicitly. |
| D-008 | Generated textures/sounds live in gitignored `generated/` directories and are produced by `pnpm assets`, which `pnpm build` runs first. | Assets must be reproducible from scripts, and must not bloat the repository. |
| D-009 | Headless Chromium runs with ANGLE/SwiftShader flags (`--use-angle=swiftshader`, `--enable-unsafe-swiftshader`). | GitHub runners have no GPU; WebGL2 would otherwise fail and the console-error-zero gate could never pass. |
| D-010 | `tests/**` (E2E + performance harness) is owned by L1-D, extending the table in the request. | The harness needs the client and QA toolchain; nobody else touches it. |
| D-011 | The integration branch `integration/mc-20260916` is created up front from `main`. | Phase 6 merges one branch at a time into it with `merge --no-ff`. |
