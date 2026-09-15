import { expect, test } from '@playwright/test'
import { BLOCK, PERF } from '@voxelcraft/core-types'
import {
  buildTestUrl,
  collectPageErrors,
  E2E_SEED,
  MISSING_TEST_API,
  waitForTestApi,
  type VcTestApi,
} from '../src/harness'

type WindowWithVc = Window & { __vc: VcTestApi }

interface BlockPos {
  x: number
  y: number
  z: number
}

test.describe('deterministic world persistence', () => {
  test.slow()

  test('break, place, save and reload restore the same world state', async ({ page }) => {
    const errors = collectPageErrors(page)

    await page.setViewportSize({ width: PERF.e2eCanvasWidth, height: PERF.e2eCanvasHeight })
    await page.goto(buildTestUrl())
    await page.screenshot({ path: 'test-results/seeded-boot.png' })
    expect(errors.join(' | '), 'the seeded boot must not log console errors').toBe('')

    const hasTestApi = await waitForTestApi(page)
    test.skip(!hasTestApi, MISSING_TEST_API)

    await page.evaluate(() => (window as WindowWithVc).__vc.ready)

    const boot = await page.evaluate(() => {
      const vc = (window as WindowWithVc).__vc
      return { state: vc.state(), hash: vc.hash() }
    })
    expect(boot.state.seed).toBe(E2E_SEED)
    expect(boot.state.renderDistance).toBe(PERF.e2eRenderDistance)
    expect(boot.state.screen).toBe('playing')
    expect(boot.state.chunks).toBeGreaterThan(0)

    // Pick the first solid block under the spawn point.
    const found = await page.evaluate(() => {
      const vc = (window as WindowWithVc).__vc
      const state = vc.state()
      const x = Math.floor(state.x)
      const z = Math.floor(state.z)
      const from = Math.min(250, Math.max(1, Math.floor(state.y)))
      for (let y = from; y > 0; y--) {
        const id = vc.getBlock(x, y, z)
        if (id !== 0) return { x, y, z, id }
      }
      return null
    })
    expect(found, 'expected a solid block below the spawn point').not.toBeNull()
    const target = found as BlockPos & { id: number }

    // Place a block that differs from the original so the world hash has to move.
    const replacement = target.id === BLOCK.STONE ? BLOCK.GLASS : BLOCK.STONE

    const broken = await page.evaluate((pos: BlockPos) => {
      const vc = (window as WindowWithVc).__vc
      vc.breakBlock(pos.x, pos.y, pos.z)
      return vc.getBlock(pos.x, pos.y, pos.z)
    }, target)
    expect(broken, 'breakBlock must clear the voxel').toBe(0)

    const placed = await page.evaluate(
      (args: { pos: BlockPos; id: number }) => {
        const vc = (window as WindowWithVc).__vc
        vc.placeBlock(args.pos.x, args.pos.y, args.pos.z, args.id)
        return vc.getBlock(args.pos.x, args.pos.y, args.pos.z)
      },
      { pos: target, id: replacement },
    )
    expect(placed, 'placeBlock must write the requested id').toBe(replacement)

    const saved = await page.evaluate(async () => {
      const vc = (window as WindowWithVc).__vc
      await vc.save()
      return { hash: vc.hash(), worldId: vc.state().worldId }
    })
    expect(saved.hash, 'editing the world must change its hash').not.toBe(boot.hash)

    await page.reload()
    const reloadedApi = await waitForTestApi(page)
    expect(reloadedApi, 'window.__vc must be available again after a reload').toBe(true)
    await page.evaluate(() => (window as WindowWithVc).__vc.ready)

    const after = await page.evaluate((pos: BlockPos) => {
      const vc = (window as WindowWithVc).__vc
      return {
        hash: vc.hash(),
        block: vc.getBlock(pos.x, pos.y, pos.z),
        worldId: vc.state().worldId,
        seed: vc.state().seed,
        errors: vc.errors.slice(),
      }
    }, target)

    expect(after.seed).toBe(E2E_SEED)
    expect(after.worldId).toBe(saved.worldId)
    expect(after.block, 'the placed block must survive the reload').toBe(replacement)
    expect(after.hash, 'the world hash must match the saved hash').toBe(saved.hash)
    expect(after.errors, 'the game must not record internal errors').toEqual([])

    await page.screenshot({ path: 'test-results/persistence-after-reload.png' })
    expect(errors.join(' | '), 'the whole loop must not log console errors').toBe('')
  })
})
