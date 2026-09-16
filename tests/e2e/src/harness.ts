import type { Page } from '@playwright/test'
import { PERF } from '@voxelcraft/core-types'

/** Fixed seed for every deterministic end-to-end run. */
export const E2E_SEED = 1337

export const E2E_DEFAULTS = {
	seed: E2E_SEED,
	renderDistance: PERF.e2eRenderDistance,
	width: PERF.e2eCanvasWidth,
	height: PERF.e2eCanvasHeight,
} as const

export interface TestUrlOptions {
	seed?: number
	renderDistance?: number
	width?: number
	height?: number
	path?: string
	/** Appends `&workers=1|0`. Omitted when undefined; the app enables workers by default. */
	workers?: boolean
}

/**
 * Test-mode entry point implemented by apps/game:
 * `?test=1&seed=<int>&rd=<render distance>&w=<width>&h=<height>[&workers=0|1]`.
 * test=1 skips pointer lock and the title screen and boots straight into play.
 */
export function buildTestUrl(options: TestUrlOptions = {}): string {
	const seed = options.seed ?? E2E_DEFAULTS.seed
	const renderDistance = options.renderDistance ?? E2E_DEFAULTS.renderDistance
	const width = options.width ?? E2E_DEFAULTS.width
	const height = options.height ?? E2E_DEFAULTS.height
	const path = options.path ?? '/'
	const workers = options.workers === undefined ? '' : `&workers=${options.workers ? 1 : 0}`
	return `${path}?test=1&seed=${seed}&rd=${renderDistance}&w=${width}&h=${height}${workers}`
}

export interface VcState {
	screen: string
	seed: number
	worldId: string
	x: number
	y: number
	z: number
	chunks: number
	quads: number
	drawCalls: number
	fps: number
	tick: number
	renderDistance: number
}

/**
 * Mesher pool telemetry. It exists so the suite can prove where a chunk was
 * meshed: `inline > 0` means the app quietly meshed on the main thread instead
 * of using its worker pool.
 */
export interface VcMesherStats {
	/** Live meshing workers. Zero means the pool fell back to the main thread. */
	workers: number
	/** Accepted meshes produced on the main thread. Must stay 0 with workers on. */
	inline: number
	/** Accepted meshes produced inside a worker. */
	worker: number
	/** Accepted meshes, wherever they were produced. */
	meshed: number
	skipped: number
	errors: number
	requested: number
	pending: number
}

/** `window.__vc`, exposed by apps/game only when test=1. */
export interface VcTestApi {
	ready: Promise<void>
	state(): VcState
	mesher(): VcMesherStats
	getBlock(x: number, y: number, z: number): number
	breakBlock(x: number, y: number, z: number): void
	placeBlock(x: number, y: number, z: number, id: number): void
	save(): Promise<void>
	hash(): number
	errors: string[]
}

/** `window.__vc` is injected at runtime, so it is not part of the Window type. */
export type WindowWithVc = { __vc: VcTestApi }

/**
 * Collects console errors, console warnings and uncaught page errors.
 *
 * A warning is a failure too: the app only warns when it degrades (a failed
 * save, a mesher error, an asset fallback), so a warning means the run was not
 * clean even if nothing threw.
 */
export function collectConsoleIssues(page: Page): string[] {
	const issues: string[] = []
	page.on('console', (message) => {
		const type = message.type()
		if (type === 'error') issues.push(`console.error: ${message.text()}`)
		else if (type === 'warning') issues.push(`console.warn: ${message.text()}`)
	})
	page.on('pageerror', (error) => {
		issues.push(`pageerror: ${error.message}`)
	})
	return issues
}

export const MISSING_TEST_API =
	'window.__vc was never exposed: apps/game must install the test API when ?test=1 is set. ' +
	'A missing test API is a hard failure, never a skipped test.'

/** Waits for window.__vc. Throws MISSING_TEST_API rather than skipping the test. */
export async function waitForTestApi(page: Page, timeout = 30000): Promise<void> {
	try {
		await page.waitForFunction(
			() => typeof (window as unknown as { __vc?: unknown }).__vc === 'object',
			undefined,
			{ timeout },
		)
	} catch {
		throw new Error(`${MISSING_TEST_API} (waited ${timeout}ms)`)
	}
}

/** Awaits the app's own readiness promise (first geometry on screen). */
export async function waitForReady(page: Page): Promise<void> {
	await page.evaluate(() => (window as unknown as WindowWithVc).__vc.ready)
}

/** Current mesher telemetry of the running app. */
export async function readMesherStats(page: Page): Promise<VcMesherStats> {
	return page.evaluate(() => (window as unknown as WindowWithVc).__vc.mesher())
}

export const MISSING_WEBGL =
	'chromium did not provide a WebGL2 context; the launch flags in playwright.config.ts have to ' +
	'give the browser a working (software) GL stack'

export interface WebGlInfo {
	supported: boolean
	version: string
	renderer: string
	detail: string
}

/** Reads the real WebGL capability of the browser under test. */
export async function readWebGlInfo(page: Page): Promise<WebGlInfo> {
	return page.evaluate(() => {
		const canvas = document.createElement('canvas')
		canvas.width = 32
		canvas.height = 32
		let gl: WebGL2RenderingContext | null = null
		let detail = ''
		try {
			gl = canvas.getContext('webgl2')
		} catch (error) {
			detail = error instanceof Error ? error.message : String(error)
		}
		if (gl === null) {
			return {
				supported: false,
				version: '',
				renderer: '',
				detail: detail === '' ? 'canvas.getContext("webgl2") returned null' : detail,
			}
		}
		const debug = gl.getExtension('WEBGL_debug_renderer_info')
		const renderer =
			debug === null ? gl.getParameter(gl.RENDERER) : gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
		const info = {
			supported: true,
			version: String(gl.getParameter(gl.VERSION)),
			renderer: String(renderer),
			detail: '',
		}
		// Release the probe context again so the game keeps its own.
		const lose = gl.getExtension('WEBGL_lose_context')
		if (lose !== null) lose.loseContext()
		return info
	})
}
