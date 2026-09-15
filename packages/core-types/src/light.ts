export const MAX_LIGHT = 15

/** Optical properties of a block, the only input the light engine needs. */
export interface LightProps {
	/** 0..15, subtracted on top of the constant -1 per step. */
	opacity: number
	/** 0..15 emitted block light. */
	emission: number
	/** Sky light 15 passes straight down without attenuation. */
	skyPassThrough: boolean
	/** Extra sky-only attenuation (water 1, leaves 1). */
	skyFilter: number
}

export function getSkyLight(light: Uint8Array, i: number): number {
	return light[i] >>> 4
}
export function setSkyLight(light: Uint8Array, i: number, v: number): void {
	light[i] = (light[i] & 0x0f) | ((v & 15) << 4)
}
export function getBlockLight(light: Uint8Array, i: number): number {
	return light[i] & 0x0f
}
export function setBlockLight(light: Uint8Array, i: number, v: number): void {
	light[i] = (light[i] & 0xf0) | (v & 15)
}

/** Re-light only when this key changes. Fluid level changes must not touch light. */
export function lightKey(p: LightProps): number {
	return (p.opacity << 6) | (p.emission << 2) | (p.skyFilter << 1) | (p.skyPassThrough ? 1 : 0)
}

export interface LightEngine {
	/** Full recompute for a freshly generated chunk (own chunk only). */
	seedChunk(cx: number, cz: number): void
	/** Cross-chunk re-propagation. passes must default to 2 (diagonal convergence). */
	stitchBoundaries(passes?: number): void
	onBlockChanged(
		x: number,
		y: number,
		z: number,
		before: LightProps,
		after: LightProps,
	): void
	/** Processes at most budgetOps writes. Returns the number performed. */
	step(budgetOps: number): number
	/** Fills out with packed (cx, cz, sectionMask) triples. Returns triple count. */
	drainDirtySections(out: Int32Array): number
}
