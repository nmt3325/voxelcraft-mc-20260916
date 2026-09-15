// Shared scalar identifiers and small geometry types.
// Plain numbers on purpose: branded types add friction across parallel teams.

export type BlockId = number
export type ItemId = number
export type BiomeId = number
export type EntityId = number
export type Tick = number

export interface Vec3i {
	x: number
	y: number
	z: number
}

export interface Vec3f {
	x: number
	y: number
	z: number
}

export interface ChunkPos {
	cx: number
	cz: number
}

/** Canonical face order. Used by the mesher, light propagation and redstone. */
export const FACE = {
	NegX: 0,
	PosX: 1,
	NegY: 2,
	PosY: 3,
	NegZ: 4,
	PosZ: 5,
} as const
export type Face = (typeof FACE)[keyof typeof FACE]

export const FACE_DIRS: readonly Vec3i[] = [
	{ x: -1, y: 0, z: 0 },
	{ x: 1, y: 0, z: 0 },
	{ x: 0, y: -1, z: 0 },
	{ x: 0, y: 1, z: 0 },
	{ x: 0, y: 0, z: -1 },
	{ x: 0, y: 0, z: 1 },
]

export const OPPOSITE_FACE: readonly Face[] = [
	FACE.PosX,
	FACE.NegX,
	FACE.PosY,
	FACE.NegY,
	FACE.PosZ,
	FACE.NegZ,
]
