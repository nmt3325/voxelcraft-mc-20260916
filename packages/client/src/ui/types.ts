/**
 * UI contract between apps/game (owned by client-a) and the UI layer (client-c).
 *
 * client-a owns the game state and adapts it into a `UiSnapshot` every frame.
 * The UI never reaches into the game: it only reports intent through `UiHost`.
 */

export type UiScreen =
	| 'loading'
	| 'title'
	| 'worldSelect'
	| 'worldCreate'
	| 'playing'
	| 'pause'
	| 'inventory'
	| 'settings'

export interface UiSlot {
	itemId: number
	count: number
	/** Remaining durability as a 0..1 fraction. null when the item is not damageable. */
	durability: number | null
	label: string
}

export interface UiDebugInfo {
	fps: number
	x: number
	y: number
	z: number
	yaw: number
	pitch: number
	biome: string
	chunks: number
	drawCalls: number
	quads: number
	triangles: number
	renderDistance: number
}

export interface UiSettings {
	renderDistance: number
	fov: number
	sensitivity: number
	volume: number
	showDebug: boolean
}

export interface UiWorldEntry {
	worldId: string
	name: string
	seed: number
	lastPlayedAt: number
}

export interface UiSnapshot {
	screen: UiScreen
	health: number
	maxHealth: number
	hunger: number
	maxHunger: number
	hotbar: readonly UiSlot[]
	selectedSlot: number
	inventory: readonly UiSlot[]
	/** Length 4 renders a 2x2 grid, length 9 renders a 3x3 grid. */
	craftingGrid: readonly (UiSlot | null)[]
	craftingResult: UiSlot | null
	debug: UiDebugInfo
	settings: UiSettings
	worlds: readonly UiWorldEntry[]
}

export interface UiHost {
	onSelectHotbar?(index: number): void
	onToggleInventory?(): void
	/** Escape, or a screen's own close/back button. The title screen uses it to advance. */
	onCloseScreen?(): void
	onResume?(): void
	onOpenSettings?(): void
	onChangeSetting?(key: keyof UiSettings, value: number | boolean): void
	onCreateWorld?(name: string, seed: number): void
	onSelectWorld?(worldId: string): void
	onDeleteWorld?(worldId: string): void
	onSave?(): void
	onQuit?(): void
	onCraft?(): void
	onMoveStack?(from: number, to: number): void
	/** Mobile touch controls; see packages/client/src/input. */
	onTouchInput?(bits: number): void
	onTouchLook?(delta: { yaw: number; pitch: number }): void
	onTouchUse?(): void
	onTouchAttack?(active: boolean): void
	onPlaySound?(name: string): void
}

export interface UiHandle {
	element: HTMLElement
	update(snapshot: UiSnapshot): void
	dispose(): void
}

/** Internal shape shared by every screen module. */
export interface UiPanel {
	element: HTMLElement
	update(snapshot: UiSnapshot): void
	dispose?(): void
}
