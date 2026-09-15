import { PERF } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import { buildTestUrl, E2E_DEFAULTS, E2E_SEED } from '../src/harness'

describe('buildTestUrl', () => {
  it('uses the contract E2E defaults', () => {
    expect(buildTestUrl()).toBe(
      `/?test=1&seed=${E2E_SEED}&rd=${PERF.e2eRenderDistance}` +
        `&w=${PERF.e2eCanvasWidth}&h=${PERF.e2eCanvasHeight}`,
    )
  })

  it('pins the defaults to PERF', () => {
    expect(E2E_DEFAULTS.renderDistance).toBe(PERF.e2eRenderDistance)
    expect(E2E_DEFAULTS.width).toBe(PERF.e2eCanvasWidth)
    expect(E2E_DEFAULTS.height).toBe(PERF.e2eCanvasHeight)
  })

  it('allows explicit overrides', () => {
    expect(
      buildTestUrl({ seed: 7, renderDistance: 4, width: 320, height: 180, path: '/index.html' }),
    ).toBe('/index.html?test=1&seed=7&rd=4&w=320&h=180')
  })
})
