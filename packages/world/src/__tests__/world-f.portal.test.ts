/**
 * Portal frames and dimension linking. Owned by task v2-world-portal (an L2 of
 * task v2-world); it only exercises `src/portal/**`.
 *
 * The fake view below is a plain Map of world voxels where an unset voxel
 * reads as air, so each test only places the blocks it cares about. A few tests
 * also run against a real generated nether region. Nothing here depends on the
 * wall clock or on the order things were built.
 */
import { describe, expect, it } from 'vitest'
import {
	BLOCK,
	BLOCK_V2,
	DIMENSION,
	DIMENSION_PARAMS,
	NETHER_GEN,
	PORTAL,
} from '@voxelcraft/core-types'
import type { BlockId, VoxelEditView } from '@voxelcraft/core-types'
import { createWorldGenerator, generateRegion, isLiquidBlock, isSolidBlock } from '../index'
import type { PortalFrame } from '../internal'
import { createPortalLinker, validateFrameAt } from '../portal'
import type { PortalAxis } from '../portal'

const SEEDS = [1337, 20260916]
const AXES: PortalAxis[] = ['x', 'z']

/** Sparse editable view: only what a test places exists, the rest is air. */
class FakeView implements VoxelEditView {
	private readonly voxels = new Map<string, number>()

	getBlock(x: number, y: number, z: number): BlockId {
		return this.voxels.get(`${x},${y},${z}`) ?? BLOCK.AIR
	}

	getFluid(_x: number, _y: number, _z: number): number {
		return 0
	}

	isSolid(x: number, y: number, z: number): boolean {
		return isSolidBlock(this.getBlock(x, y, z))
	}

	isLiquid(x: number, y: number, z: number): boolean {
		return isLiquidBlock(this.getBlock(x, y, z))
	}

	isLoaded(_cx: number, _cz: number): boolean {
		return true
	}

	setBlock(x: number, y: number, z: number, id: BlockId): void {
		this.voxels.set(`${x},${y},${z}`, id)
	}

	setFluid(_x: number, _y: number, _z: number, _packed: number): void {}

	fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: BlockId): void {
		for (let y = y0; y <= y1; y++) {
			for (let z = z0; z <= z1; z++) {
				for (let x = x0; x <= x1; x++) this.setBlock(x, y, z, id)
			}
		}
	}
}

/** A frame described in plane coordinates: `a0` along the axis, `b` the side. */
interface FrameSpec {
	axis: PortalAxis
	a0: number
	y0: number
	b: number
	innerWidth: number
	innerHeight: number
	corners?: boolean
	interior?: BlockId
}

function planeWrite(view: FakeView, spec: FrameSpec, a: number, y: number, id: BlockId): void {
	if (spec.axis === 'x') view.setBlock(a, y, spec.b, id)
	else view.setBlock(spec.b, y, a, id)
}

/** Places a frame and returns its lowest inner corner in world coordinates. */
function placeFrame(view: FakeView, spec: FrameSpec): { x: number; y: number; z: number } {
	const { a0, y0, innerWidth, innerHeight } = spec
	for (let i = 0; i < innerWidth; i++) {
		planeWrite(view, spec, a0 + i, y0 - 1, PORTAL.frameBlock)
		planeWrite(view, spec, a0 + i, y0 + innerHeight, PORTAL.frameBlock)
	}
	for (let j = 0; j < innerHeight; j++) {
		planeWrite(view, spec, a0 - 1, y0 + j, PORTAL.frameBlock)
		planeWrite(view, spec, a0 + innerWidth, y0 + j, PORTAL.frameBlock)
	}
	if (spec.corners === true) {
		planeWrite(view, spec, a0 - 1, y0 - 1, PORTAL.frameBlock)
		planeWrite(view, spec, a0 + innerWidth, y0 - 1, PORTAL.frameBlock)
		planeWrite(view, spec, a0 - 1, y0 + innerHeight, PORTAL.frameBlock)
		planeWrite(view, spec, a0 + innerWidth, y0 + innerHeight, PORTAL.frameBlock)
	}
	if (spec.interior !== undefined) {
		for (let j = 0; j < innerHeight; j++) {
			for (let i = 0; i < innerWidth; i++) {
				planeWrite(view, spec, a0 + i, y0 + j, spec.interior)
			}
		}
	}
	return spec.axis === 'x' ? { x: a0, y: y0, z: spec.b } : { x: spec.b, y: y0, z: a0 }
}

function expectedFrame(spec: FrameSpec): PortalFrame {
	const inner = spec.axis === 'x' ? { x: spec.a0, z: spec.b } : { x: spec.b, z: spec.a0 }
	return {
		axis: spec.axis,
		x: inner.x,
		y: spec.y0,
		z: inner.z,
		innerWidth: spec.innerWidth,
		innerHeight: spec.innerHeight,
	}
}

function minSpec(axis: PortalAxis, a0: number, y0: number, b: number): FrameSpec {
	return {
		axis,
		a0,
		y0,
		b,
		innerWidth: PORTAL.minInnerWidth,
		innerHeight: PORTAL.minInnerHeight,
	}
}

/** Footprint voxels of a frame, plus the row under its sill. */
function lavaInFootprint(view: VoxelEditView, frame: PortalFrame): string[] {
	const a0 = frame.axis === 'x' ? frame.x : frame.z
	const b = frame.axis === 'x' ? frame.z : frame.x
	const found: string[] = []
	for (let j = -2; j <= frame.innerHeight; j++) {
		for (let i = -1; i <= frame.innerWidth; i++) {
			const x = frame.axis === 'x' ? a0 + i : b
			const z = frame.axis === 'x' ? b : a0 + i
			const y = frame.y + j
			const id = view.getBlock(x, y, z)
			if (id === BLOCK.LAVA || id === BLOCK.LAVA_FLOWING) found.push(`${x},${y},${z}`)
		}
	}
	return found
}

describe('portal frame validation', () => {
	it.each(AXES)('accepts the frozen minimum inner size on the %s axis', (axis) => {
		const spec = minSpec(axis, 4, 40, -3)
		const view = new FakeView()
		const inner = placeFrame(view, spec)
		expect(validateFrameAt(view, inner.x, inner.y, inner.z)).toEqual(expectedFrame(spec))
	})

	it.each(AXES)('accepts the frozen maximum inner size on the %s axis', (axis) => {
		const spec: FrameSpec = {
			axis,
			a0: -5,
			y0: 40,
			b: 2,
			innerWidth: PORTAL.maxInnerWidth,
			innerHeight: PORTAL.maxInnerHeight,
		}
		const view = new FakeView()
		const inner = placeFrame(view, spec)
		expect(validateFrameAt(view, inner.x, inner.y, inner.z)).toEqual(expectedFrame(spec))
		// Also from the middle, where both scans have to run in both directions.
		const midA = spec.a0 + Math.floor(spec.innerWidth / 2)
		const midY = spec.y0 + Math.floor(spec.innerHeight / 2)
		const mid = axis === 'x' ? { x: midA, z: spec.b } : { x: spec.b, z: midA }
		expect(validateFrameAt(view, mid.x, midY, mid.z)).toEqual(expectedFrame(spec))
	})

	it.each(AXES)('rejects an opening below the frozen minimum on the %s axis', (axis) => {
		const narrow: FrameSpec = {
			axis,
			a0: 0,
			y0: 40,
			b: 0,
			innerWidth: PORTAL.minInnerWidth - 1,
			innerHeight: PORTAL.minInnerHeight,
		}
		const low: FrameSpec = {
			axis,
			a0: 0,
			y0: 40,
			b: 0,
			innerWidth: PORTAL.minInnerWidth,
			innerHeight: PORTAL.minInnerHeight - 1,
		}
		for (const spec of [narrow, low]) {
			const view = new FakeView()
			const inner = placeFrame(view, spec)
			expect(validateFrameAt(view, inner.x, inner.y, inner.z)).toBeNull()
		}
	})

	it.each(AXES)('rejects an opening above the frozen maximum on the %s axis', (axis) => {
		const wide: FrameSpec = {
			axis,
			a0: 0,
			y0: 40,
			b: 0,
			innerWidth: PORTAL.maxInnerWidth + 1,
			innerHeight: PORTAL.minInnerHeight,
		}
		const tall: FrameSpec = {
			axis,
			a0: 0,
			y0: 40,
			b: 0,
			innerWidth: PORTAL.minInnerWidth,
			innerHeight: PORTAL.maxInnerHeight + 1,
		}
		for (const spec of [wide, tall]) {
			const view = new FakeView()
			const inner = placeFrame(view, spec)
			expect(validateFrameAt(view, inner.x, inner.y, inner.z)).toBeNull()
			const midA = spec.a0 + Math.floor(spec.innerWidth / 2)
			const midY = spec.y0 + Math.floor(spec.innerHeight / 2)
			const mid = axis === 'x' ? { x: midA, z: spec.b } : { x: spec.b, z: midA }
			expect(validateFrameAt(view, mid.x, midY, mid.z)).toBeNull()
		}
	})

	it.each(AXES)('rejects a border with a gap on the %s axis', (axis) => {
		const spec = minSpec(axis, 0, 40, 0)
		// A hole in the sill, a hole in a jamb, and a jamb voxel of the wrong
		// material: all three are a broken frame.
		const breaks: Array<{ a: number; y: number; id: BlockId }> = [
			{ a: spec.a0, y: spec.y0 - 1, id: BLOCK.AIR },
			{ a: spec.a0 - 1, y: spec.y0 + 1, id: BLOCK.AIR },
			{ a: spec.a0 + spec.innerWidth, y: spec.y0, id: BLOCK_V2.NETHERRACK },
			{ a: spec.a0 + 1, y: spec.y0 + spec.innerHeight, id: BLOCK_V2.NETHERRACK },
		]
		for (const broken of breaks) {
			const view = new FakeView()
			const inner = placeFrame(view, spec)
			expect(validateFrameAt(view, inner.x, inner.y, inner.z)).toEqual(expectedFrame(spec))
			planeWrite(view, spec, broken.a, broken.y, broken.id)
			expect(validateFrameAt(view, inner.x, inner.y, inner.z)).toBeNull()
		}
	})

	it('requires the interior to be air or an existing portal', () => {
		const spec: FrameSpec = { ...minSpec('x', 0, 40, 0), innerWidth: 3 }
		const lit = new FakeView()
		const inner = placeFrame(lit, { ...spec, interior: BLOCK_V2.NETHER_PORTAL })
		expect(validateFrameAt(lit, inner.x, inner.y, inner.z)).toEqual(expectedFrame(spec))

		const blocked = new FakeView()
		placeFrame(blocked, spec)
		planeWrite(blocked, spec, spec.a0 + 1, spec.y0 + 1, BLOCK_V2.NETHERRACK)
		expect(validateFrameAt(blocked, inner.x, inner.y, inner.z)).toBeNull()
	})

	it('ignores corner blocks, so a bare and a boxed frame validate the same', () => {
		const spec = minSpec('z', 7, 40, -2)
		const bare = new FakeView()
		const boxed = new FakeView()
		const inner = placeFrame(bare, spec)
		placeFrame(boxed, { ...spec, corners: true })
		const fromBare = validateFrameAt(bare, inner.x, inner.y, inner.z)
		expect(fromBare).toEqual(expectedFrame(spec))
		expect(validateFrameAt(boxed, inner.x, inner.y, inner.z)).toEqual(fromBare)
	})
})

describe('portal linking across dimensions', () => {
	const linker = createPortalLinker(SEEDS[0], DIMENSION.Overworld)

	it('divides by the frozen scale on the way to the nether, negatives included', () => {
		expect(linker.linkedPosition(DIMENSION.Overworld, DIMENSION.Nether, 64, 70, -9)).toEqual({
			x: 8,
			y: 70,
			z: -2,
		})
		expect(linker.linkedPosition(DIMENSION.Overworld, DIMENSION.Nether, -1, 70, -8)).toEqual({
			x: -1,
			y: 70,
			z: -1,
		})
		expect(linker.linkedPosition(DIMENSION.Overworld, DIMENSION.Nether, 7, 70, 8)).toEqual({
			x: 0,
			y: 70,
			z: 1,
		})
	})

	it('multiplies by the frozen scale on the way back to the overworld', () => {
		expect(linker.linkedPosition(DIMENSION.Nether, DIMENSION.Overworld, 8, 70, -2)).toEqual({
			x: 64,
			y: 70,
			z: -16,
		})
		expect(linker.linkedPosition(DIMENSION.Nether, DIMENSION.Overworld, -1, 70, 0)).toEqual({
			x: -8,
			y: 70,
			z: 0,
		})
	})

	it('keeps a nether column stable across a round trip', () => {
		for (const value of [-513, -129, -64, -9, -1, 0, 1, 7, 64, 513]) {
			const nether = linker.linkedPosition(DIMENSION.Overworld, DIMENSION.Nether, value, 70, value)
			expect(nether.x).toBe(Math.floor(value / 8))
			const back = linker.linkedPosition(
				DIMENSION.Nether,
				DIMENSION.Overworld,
				nether.x,
				nether.y,
				nether.z,
			)
			expect(back.x).toBe(Math.floor(value / 8) * 8)
			expect(
				linker.linkedPosition(DIMENSION.Overworld, DIMENSION.Nether, back.x, back.y, back.z),
			).toEqual(nether)
		}
	})

	it('leaves coordinates alone within one dimension', () => {
		expect(linker.linkedPosition(DIMENSION.Nether, DIMENSION.Nether, -37, 70, 41)).toEqual({
			x: -37,
			y: 70,
			z: 41,
		})
	})

	it('clamps the destination y into the destination dimension', () => {
		expect(linker.linkedPosition(DIMENSION.Overworld, DIMENSION.Nether, 0, 200, 0).y).toBe(
			DIMENSION_PARAMS[DIMENSION.Nether].ceilingY,
		)
		expect(linker.linkedPosition(DIMENSION.Nether, DIMENSION.Overworld, 0, 999, 0).y).toBe(
			DIMENSION_PARAMS[DIMENSION.Overworld].ceilingY,
		)
		expect(linker.linkedPosition(DIMENSION.Overworld, DIMENSION.Nether, 0, -5, 0).y).toBe(0)
	})

	it.each(SEEDS)('depends on the coordinates only, not on seed %i', (seed) => {
		const expected = linker.linkedPosition(DIMENSION.Overworld, DIMENSION.Nether, -137, 91, 251)
		const other = createPortalLinker(seed, DIMENSION.Nether)
		expect(other.linkedPosition(DIMENSION.Overworld, DIMENSION.Nether, -137, 91, 251)).toEqual(
			expected,
		)
		expect(other.linkedPosition(DIMENSION.Overworld, DIMENSION.Nether, -137, 91, 251)).toEqual(
			expected,
		)
	})
})

describe('link target search', () => {
	it.each(SEEDS)('returns the nearest frame for seed %i', (seed) => {
		const near = minSpec('x', 5, 40, 0)
		const far = minSpec('x', 30, 40, 0)
		const view = new FakeView()
		placeFrame(view, far)
		placeFrame(view, near)
		const linker = createPortalLinker(seed, DIMENSION.Nether)
		expect(linker.findLinkTarget(view, 0, 40, 0)).toEqual(expectedFrame(near))
	})

	it.each(SEEDS)('ignores the order the frames were built in, seed %i', (seed) => {
		// Two frames exactly 11 voxels away on either side: only the fixed
		// tie-break can decide, and it must decide the same way every time.
		const left = minSpec('x', -12, 40, 0)
		const right = minSpec('x', 11, 40, 0)
		const built = new FakeView()
		placeFrame(built, left)
		placeFrame(built, right)
		const reversed = new FakeView()
		placeFrame(reversed, right)
		placeFrame(reversed, left)
		const linker = createPortalLinker(seed, DIMENSION.Nether)
		const chosen = linker.findLinkTarget(built, 0, 40, 0)
		expect(chosen).not.toBeNull()
		expect(linker.findLinkTarget(reversed, 0, 40, 0)).toEqual(chosen)
		expect(linker.findLinkTarget(built, 0, 40, 0)).toEqual(chosen)
	})

	it.each(SEEDS)('finds a lit portal, not only an empty frame, seed %i', (seed) => {
		const spec: FrameSpec = {
			axis: 'z',
			a0: -7,
			y0: 44,
			b: 3,
			innerWidth: 3,
			innerHeight: 4,
			interior: BLOCK_V2.NETHER_PORTAL,
		}
		const view = new FakeView()
		placeFrame(view, spec)
		const linker = createPortalLinker(seed, DIMENSION.Nether)
		expect(linker.findLinkTarget(view, 0, 44, 3)).toEqual(expectedFrame(spec))
	})

	it('returns null when the only frame is outside the frozen search radius', () => {
		const view = new FakeView()
		placeFrame(view, minSpec('x', PORTAL.linkSearchRadius + 20, 40, 0))
		const linker = createPortalLinker(SEEDS[0], DIMENSION.Nether)
		expect(linker.findLinkTarget(view, 0, 40, 0)).toBeNull()
	}, 30000)
})

describe('landing', () => {
	function flatNether(): FakeView {
		const view = new FakeView()
		view.fill(-40, 39, -40, 40, 39, 40, BLOCK_V2.NETHERRACK)
		return view
	}

	it.each(SEEDS)(
		'builds a minimum size frame when none is in range, seed %i',
		(seed) => {
			const view = flatNether()
			const linker = createPortalLinker(seed, DIMENSION.Nether)
			const landing = linker.ensureLanding(view, DIMENSION.Nether, 0, 40, 0)
			if (landing === null) throw new Error('expected a landing')
			expect(landing.created).toBe(true)
			expect([landing.frame.innerWidth, landing.frame.innerHeight]).toEqual([
				PORTAL.minInnerWidth,
				PORTAL.minInnerHeight,
			])
			expect(validateFrameAt(view, landing.frame.x, landing.frame.y, landing.frame.z)).toEqual(
				landing.frame,
			)
			for (let j = 0; j < landing.frame.innerHeight; j++) {
				expect(view.getBlock(landing.frame.x, landing.frame.y + j, landing.frame.z)).toBe(
					BLOCK_V2.NETHER_PORTAL,
				)
			}
			expect(view.isSolid(landing.frame.x, landing.frame.y - 1, landing.frame.z)).toBe(true)
			// A pure function of the seed and the view, so a fresh run agrees.
			const repeat = createPortalLinker(seed, DIMENSION.Nether).ensureLanding(
				flatNether(),
				DIMENSION.Nether,
				0,
				40,
				0,
			)
			expect(repeat).toEqual(landing)
		},
		30000,
	)

	it.each(SEEDS)('reuses a frame in range instead of building one, seed %i', (seed) => {
		const view = flatNether()
		const spec: FrameSpec = { ...minSpec('x', 4, 40, 0), corners: true }
		placeFrame(view, spec)
		const linker = createPortalLinker(seed, DIMENSION.Nether)
		const landing = linker.ensureLanding(view, DIMENSION.Nether, 0, 40, 0)
		if (landing === null) throw new Error('expected a landing')
		expect(landing.created).toBe(false)
		expect(landing.frame).toEqual(expectedFrame(spec))
	})

	it.each(SEEDS)(
		'never lands in or directly over lava, seed %i',
		(seed) => {
			const view = new FakeView()
			view.fill(-30, 30, -30, 30, 30, 30, BLOCK_V2.NETHERRACK)
			view.fill(-30, 31, -30, 30, 31, 30, BLOCK.LAVA)
			// The only dry ground in range is a ledge above the lava sea.
			view.fill(6, 33, -4, 12, 33, 4, BLOCK_V2.NETHERRACK)
			const linker = createPortalLinker(seed, DIMENSION.Nether)
			const landing = linker.ensureLanding(view, DIMENSION.Nether, 0, 32, 0)
			if (landing === null) throw new Error('expected a landing')
			expect(landing.created).toBe(true)
			expect(landing.frame.y).toBe(34)
			expect(lavaInFootprint(view, landing.frame)).toEqual([])
			expect(view.isSolid(landing.frame.x, landing.frame.y - 1, landing.frame.z)).toBe(true)
		},
		30000,
	)

	it('builds a lava free landing in a generated nether region', () => {
		const seed = SEEDS[0]
		const grid = generateRegion(createWorldGenerator(seed, DIMENSION.Nether), -1, -1, 3)
		// A standable spot read straight off the terrain, without portal code.
		const columns: Array<[number, number]> = [
			[8, 8],
			[4, 12],
			[12, 4],
			[0, 0],
			[20, 20],
		]
		let query: { x: number; y: number; z: number } | null = null
		for (const [cx, cz] of columns) {
			for (let y = NETHER_GEN.lavaSeaLevel + 2; y < NETHER_GEN.roofY - 4; y++) {
				const standable =
					grid.isSolid(cx, y - 1, cz) &&
					!grid.isSolid(cx, y, cz) &&
					!grid.isLiquid(cx, y, cz) &&
					!grid.isSolid(cx, y + 1, cz) &&
					!grid.isLiquid(cx, y + 1, cz)
				if (standable) {
					query = { x: cx, y, z: cz }
					break
				}
			}
			if (query !== null) break
		}
		if (query === null) throw new Error('no standable spot in the generated region')
		const linker = createPortalLinker(seed, DIMENSION.Nether)
		const landing = linker.ensureLanding(grid, DIMENSION.Nether, query.x, query.y, query.z)
		if (landing === null) throw new Error('expected a landing')
		expect(landing.created).toBe(true)
		expect(validateFrameAt(grid, landing.frame.x, landing.frame.y, landing.frame.z)).toEqual(
			landing.frame,
		)
		expect(lavaInFootprint(grid, landing.frame)).toEqual([])
		expect(grid.isSolid(landing.frame.x, landing.frame.y - 1, landing.frame.z)).toBe(true)
	}, 60000)
})
