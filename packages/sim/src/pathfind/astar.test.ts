import { describe, expect, it } from 'vitest'
import { BLOCK, MOVE_COST, MOVE_KIND, PATHFIND } from '@voxelcraft/core-types'
import { createSimVoxelWorld } from '../shared'
import type { SimVoxelWorld } from '../shared'
import { pathDijkstra, pathFindPath, pathRequest } from './astar'
import { pathExpand, pathShape } from './moves'

/** Zombie sized agent: it needs two clear cells above the floor. */
const SHAPE = pathShape(0.6, 1.8)
/** These tests assert optimality, not the time cutoff, so time is not a factor. */
const NO_TIME_LIMIT = 1000000
const FLOOR_Y = 63
const WALK_Y = 64

/** A single loaded chunk with a stone floor, walkable at `WALK_Y`. */
function floorWorld(): SimVoxelWorld {
	const voxels = createSimVoxelWorld()
	voxels.ensureChunk(0, 0)
	for (let x = 0; x < 16; x++) {
		for (let z = 0; z < 16; z++) voxels.setBlock(x, FLOOR_Y, z, BLOCK.STONE)
	}
	return voxels
}

/** Two blocks tall, so it cannot be jumped: `jumpHeight` is a single block. */
function wall(voxels: SimVoxelWorld, x: number, z: number): void {
	voxels.setBlock(x, WALK_Y, z, BLOCK.STONE)
	voxels.setBlock(x, WALK_Y + 1, z, BLOCK.STONE)
}

/** Serpentine maze: three walls with alternating gaps. */
function mazeWorld(): SimVoxelWorld {
	const voxels = floorWorld()
	for (let x = 0; x <= 12; x++) wall(voxels, x, 3)
	for (let x = 3; x <= 15; x++) wall(voxels, x, 6)
	for (let x = 0; x <= 12; x++) wall(voxels, x, 9)
	return voxels
}

describe('pathFindPath', () => {
	it('is optimal: the A* cost equals the Dijkstra cost through a maze', () => {
		const voxels = mazeWorld()
		const req = pathRequest({
			start: { x: 0, y: WALK_Y, z: 0 },
			goal: { kind: 'block', at: { x: 0, y: WALK_Y, z: 12 } },
			shape: SHAPE,
			view: voxels,
			maxMillis: NO_TIME_LIMIT,
		})
		const astar = pathFindPath(req)
		const dijkstra = pathDijkstra(req)
		expect(astar.status).toBe('found')
		expect(dijkstra.status).toBe('found')
		expect(astar.cost).toBeCloseTo(dijkstra.cost, 6)
		expect(astar.nodes[0]).toEqual({ x: 0, y: WALK_Y, z: 0 })
		expect(astar.nodes[astar.nodes.length - 1]).toEqual({ x: 0, y: WALK_Y, z: 12 })
		// The wall at z = 3 only opens past x = 12, so the detour is real.
		expect(astar.cost).toBeGreaterThan(12)
	})

	it('reports partial when the node budget runs out', () => {
		const voxels = mazeWorld()
		const result = pathFindPath(
			pathRequest({
				start: { x: 0, y: WALK_Y, z: 0 },
				goal: { kind: 'block', at: { x: 0, y: WALK_Y, z: 12 } },
				shape: SHAPE,
				view: voxels,
				maxNodes: 3,
				maxMillis: NO_TIME_LIMIT,
			}),
		)
		expect(result.status).toBe('partial')
		expect(result.nodes[0]).toEqual({ x: 0, y: WALK_Y, z: 0 })
		expect(result.expanded).toBeLessThanOrEqual(4)
	})

	it('walks away from a threat for a runAway goal', () => {
		const voxels = floorWorld()
		const result = pathFindPath(
			pathRequest({
				start: { x: 8, y: WALK_Y, z: 8 },
				goal: { kind: 'runAway', from: { x: 8, y: WALK_Y, z: 8 }, minDistance: 5 },
				shape: SHAPE,
				view: voxels,
				maxMillis: NO_TIME_LIMIT,
			}),
		)
		expect(result.status).toBe('found')
		const last = result.nodes[result.nodes.length - 1]
		expect(Math.hypot(last.x - 8, last.y - WALK_Y, last.z - 8)).toBeGreaterThanOrEqual(5)
	})
})

describe('pathExpand', () => {
	it('refuses to cut a corner between two blocked neighbours', () => {
		const voxels = floorWorld()
		wall(voxels, 1, 0)
		wall(voxels, 0, 1)
		const steps = pathExpand(voxels, { x: 0, y: WALK_Y, z: 0 }, SHAPE)
		expect(steps.some((step) => step.x === 1 && step.z === 1)).toBe(false)
	})

	it('allows the diagonal when both neighbours are walkable', () => {
		const voxels = floorWorld()
		const steps = pathExpand(voxels, { x: 0, y: WALK_Y, z: 0 }, SHAPE)
		const diagonal = steps.find((step) => step.x === 1 && step.z === 1)
		expect(diagonal).toBeDefined()
		expect(diagonal?.kind).toBe(MOVE_KIND.Diagonal)
		expect(diagonal?.cost).toBeCloseTo(MOVE_COST.diagonal, 6)
	})

	it('treats an unloaded chunk as expensive, never as a wall', () => {
		const voxels = floorWorld()
		expect(voxels.isLoaded(1, 0)).toBe(false)
		const steps = pathExpand(voxels, { x: 15, y: WALK_Y, z: 2 }, SHAPE)
		const intoUnloaded = steps.find((step) => step.x === 16 && step.z === 2)
		expect(intoUnloaded).toBeDefined()
		expect(intoUnloaded?.cost).toBeCloseTo(MOVE_COST.traverse + PATHFIND.unloadedPenalty, 6)
	})

	it('still finds a path that has to cross unloaded ground', () => {
		const voxels = floorWorld()
		const result = pathFindPath(
			pathRequest({
				start: { x: 14, y: WALK_Y, z: 2 },
				goal: { kind: 'block', at: { x: 18, y: WALK_Y, z: 2 } },
				shape: SHAPE,
				view: voxels,
				maxMillis: NO_TIME_LIMIT,
			}),
		)
		expect(result.status).toBe('found')
		expect(result.cost).toBeGreaterThanOrEqual(PATHFIND.unloadedPenalty)
	})
})
