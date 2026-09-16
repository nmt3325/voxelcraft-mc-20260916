import { INVENTORY, PERF } from '@voxelcraft/core-types'
import type { UiSlot, UiSnapshot } from './types'

export const EMPTY_SLOT: UiSlot = { itemId: 0, count: 0, durability: null, label: '' }

/** A slot is only drawn when it holds something. */
export function filledSlot(slot: UiSlot | null | undefined): UiSlot | null {
	if (!slot) return null
	if (slot.itemId === 0 || slot.count <= 0) return null
	return slot
}

function emptySlots(count: number): UiSlot[] {
	return Array.from({ length: count }, () => ({ ...EMPTY_SLOT }))
}

/**
 * Neutral snapshot. Used as the UI's initial state so nothing is visible before
 * client-a pushes the first real frame, and as a base for tests.
 */
export function createDefaultUiSnapshot(): UiSnapshot {
	return {
		screen: 'loading',
		health: 20,
		maxHealth: 20,
		hunger: 20,
		maxHunger: 20,
		hotbar: emptySlots(INVENTORY.hotbarSlots),
		selectedSlot: 0,
		inventory: emptySlots(INVENTORY.totalSlots),
		craftingGrid: Array.from({ length: INVENTORY.craftGrid3 }, () => null),
		craftingResult: null,
		debug: {
			fps: 0,
			x: 0,
			y: 0,
			z: 0,
			yaw: 0,
			pitch: 0,
			biome: '-',
			chunks: 0,
			drawCalls: 0,
			quads: 0,
			triangles: 0,
			renderDistance: PERF.renderDistanceDefault,
		},
		settings: {
			renderDistance: PERF.renderDistanceDefault,
			fov: PERF.fovDefault,
			sensitivity: PERF.sensitivityDefault,
			volume: 1,
			showDebug: false,
		},
		worlds: [],
		xp: { level: 0, progress: 0, total: 0, orbs: 0 },
		dimension: 'Overworld',
		farm: { crops: 0, mature: 0 },
		herd: { animals: 0, babies: 0, inLove: 0 },
		multiplayer: { enabled: false, state: 'off', players: 0, address: '' },
		enchanting: null,
	}
}

/** Deterministic seed derived from a world name, so no Math.random leaks into the UI. */
export function seedFromText(text: string): number {
	let h = 0x811c9dc5 >>> 0
	for (let i = 0; i < text.length; i++) {
		h = (h ^ text.charCodeAt(i)) >>> 0
		h = Math.imul(h, 0x01000193) >>> 0
	}
	return h >>> 0
}
