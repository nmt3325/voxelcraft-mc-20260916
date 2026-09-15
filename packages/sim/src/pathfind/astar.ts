/**
 * A* navigation over the voxel graph, plus the uniform-cost search used as the
 * optimality reference in tests.
 *
 * Both searches share `pathExpand`, so the only difference is the heuristic:
 * `pathFindPath` uses the admissible and consistent octile distance,
 * `pathDijkstra` uses zero. With a consistent heuristic the first pop of a node
 * is already optimal, which is why the closed set is safe.
 *
 * Budgets come from the request (`maxNodes` / `maxMillis`, defaulted from
 * `PATHFIND`). Hitting either one returns `status: 'partial'` with the best
 * partial route instead of nothing. The clock is only read to enforce the
 * millisecond budget, never to compute simulation state, and it can be replaced
 * with `pathSetClock` so the time cutoff is reproducible in tests.
 */
import { MOVE_COST, PATHFIND } from '@voxelcraft/core-types'
import type {
	AgentShape,
	FindPath,
	MoveKind,
	PathGoal,
	PathRequest,
	PathResult,
	Vec3i,
	VoxelView,
} from '@voxelcraft/core-types'
import { pathDistance, pathExpand, pathOctile } from './moves'
import type { PathStep } from './moves'

export type PathClock = () => number

const defaultClock: PathClock = () => (typeof performance !== 'undefined' ? performance.now() : 0)

let clock: PathClock = defaultClock

/** Replaces the budget clock. `null` restores the default. Tests only. */
export function pathSetClock(next: PathClock | null): void {
	clock = next ?? defaultClock
}

export function pathNow(): number {
	return clock()
}

/** Fills the `PATHFIND` budgets so callers only describe where they want to go. */
export function pathRequest(args: {
	start: Vec3i
	goal: PathGoal
	shape: AgentShape
	view: VoxelView
	maxNodes?: number
	maxMillis?: number
}): PathRequest {
	return {
		start: args.start,
		goal: args.goal,
		shape: args.shape,
		view: args.view,
		maxNodes: args.maxNodes ?? PATHFIND.maxNodes,
		maxMillis: args.maxMillis ?? PATHFIND.maxMillis,
	}
}

/** Lower bound of the remaining cost. Zero for `runAway`, which has no target. */
export function pathGoalHeuristic(goal: PathGoal, x: number, y: number, z: number): number {
	void y
	switch (goal.kind) {
		case 'block':
			return pathOctile(x, z, goal.at.x, goal.at.z)
		case 'near':
			return Math.max(0, pathOctile(x, z, goal.at.x, goal.at.z) - goal.radius * MOVE_COST.traverse)
		default:
			return 0
	}
}

export function pathGoalReached(goal: PathGoal, x: number, y: number, z: number): boolean {
	switch (goal.kind) {
		case 'block':
			return x === goal.at.x && y === goal.at.y && z === goal.at.z
		case 'near':
			return pathDistance(x, y, z, goal.at.x, goal.at.y, goal.at.z) <= goal.radius
		default:
			return (
				pathDistance(x, y, z, goal.from.x, goal.from.y, goal.from.z) >= goal.minDistance
			)
	}
}

/**
 * Collapses runs of identical moves in the same direction into a single
 * waypoint. Geometry and total cost are unchanged, `nodes[0]` stays the start
 * and `moves[i]` still describes the step from `nodes[i]` to `nodes[i + 1]`.
 */
export function pathSmooth(
	nodes: readonly Vec3i[],
	moves: readonly MoveKind[],
): { nodes: Vec3i[]; moves: MoveKind[] } {
	if (nodes.length <= 2) {
		return { nodes: nodes.map((n) => ({ x: n.x, y: n.y, z: n.z })), moves: [...moves] }
	}
	const outNodes: Vec3i[] = [{ x: nodes[0].x, y: nodes[0].y, z: nodes[0].z }]
	const outMoves: MoveKind[] = []
	let lastDx = 0
	let lastDy = 0
	let lastDz = 0
	for (let i = 1; i < nodes.length; i++) {
		const prev = nodes[i - 1]
		const node = nodes[i]
		const dx = node.x - prev.x
		const dy = node.y - prev.y
		const dz = node.z - prev.z
		const kind = moves[i - 1]
		const sameRun =
			outMoves.length > 0 &&
			outMoves[outMoves.length - 1] === kind &&
			dx === lastDx &&
			dy === lastDy &&
			dz === lastDz
		if (sameRun) {
			outNodes[outNodes.length - 1] = { x: node.x, y: node.y, z: node.z }
		} else {
			outNodes.push({ x: node.x, y: node.y, z: node.z })
			outMoves.push(kind)
		}
		lastDx = dx
		lastDy = dy
		lastDz = dz
	}
	return { nodes: outNodes, moves: outMoves }
}

interface SearchNode {
	x: number
	y: number
	z: number
	g: number
	h: number
	f: number
	kind: MoveKind | null
	parent: number
}

function keyOf(x: number, y: number, z: number): string {
	return `${x},${y},${z}`
}

function reconstruct(nodes: SearchNode[], from: number): { nodes: Vec3i[]; moves: MoveKind[] } {
	const path: Vec3i[] = []
	const moves: MoveKind[] = []
	let cursor = from
	while (cursor >= 0) {
		const node = nodes[cursor]
		path.push({ x: node.x, y: node.y, z: node.z })
		if (node.parent >= 0 && node.kind !== null) moves.push(node.kind)
		cursor = node.parent
	}
	path.reverse()
	moves.reverse()
	return { nodes: path, moves }
}

function search(req: PathRequest, useHeuristic: boolean): PathResult {
	const view = req.view
	const shape = req.shape
	const goal = req.goal
	const maxNodes = req.maxNodes > 0 ? req.maxNodes : PATHFIND.maxNodes
	const maxMillis = req.maxMillis
	const startedAt = pathNow()

	const nodes: SearchNode[] = []
	const indexByKey = new Map<string, number>()
	const closed: boolean[] = []
	const heap: number[] = []

	const heuristicOf = (x: number, y: number, z: number): number =>
		useHeuristic ? pathGoalHeuristic(goal, x, y, z) : 0

	const less = (a: number, b: number): boolean => {
		const na = nodes[a]
		const nb = nodes[b]
		if (na.f !== nb.f) return na.f < nb.f
		if (na.h !== nb.h) return na.h < nb.h
		// Insertion order: the last tie break, so the result never depends on
		// object identity or map iteration order.
		return a < b
	}
	const push = (item: number): void => {
		heap.push(item)
		let child = heap.length - 1
		while (child > 0) {
			const parent = (child - 1) >> 1
			if (!less(heap[child], heap[parent])) break
			const swap = heap[parent]
			heap[parent] = heap[child]
			heap[child] = swap
			child = parent
		}
	}
	const pop = (): number => {
		const top = heap[0]
		const last = heap.pop() as number
		if (heap.length > 0) {
			heap[0] = last
			let cursor = 0
			for (;;) {
				const left = cursor * 2 + 1
				const right = left + 1
				let best = cursor
				if (left < heap.length && less(heap[left], heap[best])) best = left
				if (right < heap.length && less(heap[right], heap[best])) best = right
				if (best === cursor) break
				const swap = heap[best]
				heap[best] = heap[cursor]
				heap[cursor] = swap
				cursor = best
			}
		}
		return top
	}

	const startH = heuristicOf(req.start.x, req.start.y, req.start.z)
	nodes.push({
		x: req.start.x,
		y: req.start.y,
		z: req.start.z,
		g: 0,
		h: startH,
		f: startH,
		kind: null,
		parent: -1,
	})
	indexByKey.set(keyOf(req.start.x, req.start.y, req.start.z), 0)
	push(0)

	let best = 0
	let found = -1
	let cutoff = false
	let expanded = 0
	const steps: PathStep[] = []

	const isBetterPartial = (candidate: SearchNode, incumbent: SearchNode): boolean =>
		candidate.h < incumbent.h || (candidate.h === incumbent.h && candidate.g < incumbent.g)

	while (heap.length > 0) {
		const current = pop()
		if (closed[current]) continue
		const node = nodes[current]
		if (pathGoalReached(goal, node.x, node.y, node.z)) {
			found = current
			break
		}
		if (expanded >= maxNodes) {
			cutoff = true
			break
		}
		// Checked every 64 expansions: reading the clock is far more expensive
		// than expanding a node, and the budget only needs to be approximate.
		if (maxMillis > 0 && expanded > 0 && (expanded & 0x3f) === 0 && pathNow() - startedAt >= maxMillis) {
			cutoff = true
			break
		}
		closed[current] = true
		expanded++
		pathExpand(view, node, shape, steps)
		for (const step of steps) {
			const key = keyOf(step.x, step.y, step.z)
			const existing = indexByKey.get(key)
			const g = node.g + step.cost
			if (existing === undefined) {
				const h = heuristicOf(step.x, step.y, step.z)
				nodes.push({
					x: step.x,
					y: step.y,
					z: step.z,
					g,
					h,
					f: g + h,
					kind: step.kind,
					parent: current,
				})
				const at = nodes.length - 1
				indexByKey.set(key, at)
				push(at)
				if (isBetterPartial(nodes[at], nodes[best])) best = at
			} else if (!closed[existing] && g < nodes[existing].g) {
				const other = nodes[existing]
				other.g = g
				other.f = g + other.h
				other.kind = step.kind
				other.parent = current
				push(existing)
				if (isBetterPartial(other, nodes[best])) best = existing
			}
		}
	}

	const millis = pathNow() - startedAt
	const status: PathResult['status'] = found >= 0 ? 'found' : cutoff ? 'partial' : 'failed'
	const endIndex = found >= 0 ? found : cutoff ? best : -1
	if (endIndex < 0) {
		return {
			status,
			nodes: [{ x: req.start.x, y: req.start.y, z: req.start.z }],
			moves: [],
			expanded,
			millis,
			cost: 0,
		}
	}
	const raw = reconstruct(nodes, endIndex)
	const smoothed = pathSmooth(raw.nodes, raw.moves)
	return {
		status,
		nodes: smoothed.nodes,
		moves: smoothed.moves,
		expanded,
		millis,
		cost: nodes[endIndex].g,
	}
}

/** A* with the octile heuristic. The planner mobs use. */
export const pathFindPath: FindPath = (req) => search(req, true)

/** Uniform cost search over the same graph: the optimality reference. */
export const pathDijkstra: FindPath = (req) => search(req, false)
