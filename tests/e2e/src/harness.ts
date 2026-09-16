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
}

/**
 * Test-mode entry point implemented by apps/game (client-a):
 * `?test=1&seed=<int>&rd=<render distance>&w=<width>&h=<height>`.
 * test=1 skips pointer lock and the title screen and boots straight into play.
 */
export function buildTestUrl(options: TestUrlOptions = {}): string {
  const seed = options.seed ?? E2E_DEFAULTS.seed
  const renderDistance = options.renderDistance ?? E2E_DEFAULTS.renderDistance
  const width = options.width ?? E2E_DEFAULTS.width
  const height = options.height ?? E2E_DEFAULTS.height
  const path = options.path ?? '/'
  return `${path}?test=1&seed=${seed}&rd=${renderDistance}&w=${width}&h=${height}`
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

/** `window.__vc`, exposed by apps/game only when test=1. */
export interface VcTestApi {
  ready: Promise<void>
  state(): VcState
  getBlock(x: number, y: number, z: number): number
  breakBlock(x: number, y: number, z: number): void
  placeBlock(x: number, y: number, z: number, id: number): void
  save(): Promise<void>
  hash(): number
  errors: string[]
}

/** Collects browser console errors and uncaught page errors for a zero-error assertion. */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`)
  })
  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error.message}`)
  })
  return errors
}

/** Resolves true once window.__vc exists, false if it never shows up. */
export async function waitForTestApi(page: Page, timeout = 8000): Promise<boolean> {
  try {
    await page.waitForFunction(
      () => typeof (window as unknown as { __vc?: unknown }).__vc === 'object',
      undefined,
      { timeout },
    )
    return true
  } catch {
    return false
  }
}

export const MISSING_TEST_API =
  'window.__vc is not implemented yet (apps/game is owned by client-a); ' +
  'the persistence loop runs automatically once the hook lands.'
