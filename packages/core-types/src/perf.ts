/** Runtime budgets. Frozen by the contract; deviations must be recorded. */
export const PERF = {
	simTickHz: 20,
	simTickMs: 50,
	accumulatorClampMs: 250,
	chunkGenBudgetMs: 4,
	sectionMeshBudgetMs: 1.5,
	chunkMeshBudgetMs: 8,
	lightOpsPerTick: 32768,
	fluidCellsPerTick: 4096,
	redstoneUpdatesPerTick: 2048,
	pathfindMaxNodes: 3000,
	pathfindMaxMillis: 2,
	renderDistanceDefault: 8,
	renderDistanceMin: 2,
	renderDistanceMax: 16,
	fovDefault: 75,
	sensitivityDefault: 0.0022,
	uploadsPerFrame: 2,
	workerCountMax: 6,
	/** Headless SwiftShader is slow: E2E uses a small radius and canvas. */
	e2eRenderDistance: 2,
	e2eCanvasWidth: 640,
	e2eCanvasHeight: 360,
} as const

/**
 * Bench thresholds measured by tests/bench. Exceeding a threshold is reported
 * as a warning and must be explained; exceeding failFactor times it fails.
 */
export const BENCH = {
	renderDistance: 8,
	chunkGenAvgMsMax: 6,
	chunkMeshAvgMsMax: 12,
	simTickAvgMsMax: 8,
	failFactor: 3,
} as const
