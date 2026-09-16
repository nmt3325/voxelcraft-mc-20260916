import {
	BLOCK_ID_MAX,
	RENDER_LAYER,
	type BlockDef,
	type BlockId,
	type BlockRegistry,
	type LightProps,
	type RenderLayer,
} from '@voxelcraft/core-types'
import { BLOCK_DEFS } from './blockDefs'

/** Light behaviour used for ids that were never defined (treated as air). */
export const UNKNOWN_LIGHT_PROPS: LightProps = Object.freeze({
	opacity: 0,
	emission: 0,
	skyPassThrough: true,
	skyFilter: 0,
})

export interface GameplayBlockRegistry extends BlockRegistry {
	/** Non-throwing variant of `byId`. */
	tryById(id: BlockId): BlockDef | undefined
	has(id: BlockId): boolean
	count(): number
}

/**
 * Array-backed registry. Hot paths (`isSolid`, `isFullCube`, `layerOf`,
 * `lightPropsOf`) are plain index lookups, and `byId` throws on unknown ids so
 * that a missing definition surfaces immediately instead of turning into a
 * silently air-like block.
 */
export function createBlockRegistry(defs: readonly BlockDef[] = []): GameplayBlockRegistry {
	const size = BLOCK_ID_MAX + 1
	const byIdArray: (BlockDef | undefined)[] = new Array<BlockDef | undefined>(size).fill(undefined)
	const lightArray: (LightProps | undefined)[] = new Array<LightProps | undefined>(size).fill(
		undefined,
	)
	const solidFlags = new Uint8Array(size)
	const fullCubeFlags = new Uint8Array(size)
	const layers = new Uint8Array(size)
	const byNameMap = new Map<string, BlockDef>()
	let ordered: BlockDef[] | null = null
	let defined = 0

	const inRange = (id: BlockId): boolean =>
		Number.isInteger(id) && id >= 0 && id <= BLOCK_ID_MAX

	const registry: GameplayBlockRegistry = {
		define(def: BlockDef): void {
			if (!inRange(def.id)) {
				throw new RangeError(`block id out of range: ${String(def.id)} (${def.name})`)
			}
			const existingById = byIdArray[def.id]
			if (existingById !== undefined && existingById.name !== def.name) {
				throw new Error(
					`duplicate block id ${def.id}: '${existingById.name}' vs '${def.name}'`,
				)
			}
			const existingByName = byNameMap.get(def.name)
			if (existingByName !== undefined && existingByName.id !== def.id) {
				throw new Error(
					`duplicate block name '${def.name}': ${existingByName.id} vs ${def.id}`,
				)
			}
			if (existingById === undefined) defined += 1
			byIdArray[def.id] = def
			byNameMap.set(def.name, def)
			solidFlags[def.id] = def.solid ? 1 : 0
			fullCubeFlags[def.id] = def.fullCube ? 1 : 0
			layers[def.id] = def.layer
			lightArray[def.id] = Object.freeze({
				opacity: def.opacity,
				emission: def.emission,
				skyPassThrough: def.skyPassThrough,
				skyFilter: def.skyFilter,
			})
			ordered = null
		},
		byId(id: BlockId): BlockDef {
			const def = inRange(id) ? byIdArray[id] : undefined
			if (def === undefined) throw new RangeError(`unknown block id: ${String(id)}`)
			return def
		},
		tryById(id: BlockId): BlockDef | undefined {
			return inRange(id) ? byIdArray[id] : undefined
		},
		byName(name: string): BlockDef | undefined {
			return byNameMap.get(name)
		},
		all(): readonly BlockDef[] {
			if (ordered === null) {
				const out: BlockDef[] = []
				for (let id = 0; id < size; id++) {
					const def = byIdArray[id]
					if (def !== undefined) out.push(def)
				}
				ordered = out
			}
			return ordered
		},
		has(id: BlockId): boolean {
			return inRange(id) && byIdArray[id] !== undefined
		},
		count(): number {
			return defined
		},
		isSolid(id: BlockId): boolean {
			return inRange(id) ? solidFlags[id] === 1 : false
		},
		isFullCube(id: BlockId): boolean {
			return inRange(id) ? fullCubeFlags[id] === 1 : false
		},
		layerOf(id: BlockId): RenderLayer {
			if (!inRange(id) || byIdArray[id] === undefined) return RENDER_LAYER.Opaque
			return layers[id] as RenderLayer
		},
		lightPropsOf(id: BlockId): LightProps {
			const props = inRange(id) ? lightArray[id] : undefined
			return props ?? UNKNOWN_LIGHT_PROPS
		},
	}

	for (const def of defs) registry.define(def)
	return registry
}

export function createDefaultBlockRegistry(): GameplayBlockRegistry {
	return createBlockRegistry(BLOCK_DEFS)
}

/** Shared registry instance for the whole gameplay package. */
export const BLOCKS: GameplayBlockRegistry = createDefaultBlockRegistry()
