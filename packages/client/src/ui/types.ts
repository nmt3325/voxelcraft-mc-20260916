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
	| 'enchanting'

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

/** Experience totals the HUD bar and the enchanting screen both read. */
export interface UiXpInfo {
	level: number
	/** Fill ratio of the level bar, 0..1. */
	progress: number
	total: number
	/** Orbs still lying on the ground nearby. */
	orbs: number
}

/** One of the three offers an enchanting table shows. */
export interface UiEnchantOffer {
	slot: number
	levelCost: number
	lapisCost: number
	/** Readable enchantment list, e.g. "Efficiency II". */
	label: string
	/** False while the player cannot pay the level or the lapis cost. */
	affordable: boolean
}

export interface UiEnchantState {
	bookshelves: number
	lapis: number
	itemLabel: string
	offers: readonly UiEnchantOffer[]
	/** Result of the last attempt; empty while nothing was tried. */
	message: string
}

/** Crops planted in the loaded world. */
export interface UiFarmInfo {
	crops: number
	mature: number
}

/** Breedable animals in the loaded world. */
export interface UiHerdInfo {
	animals: number
	babies: number
	inLove: number
}

export type UiNetState =
	'off' | 'idle' | 'connecting' | 'awaitingWelcome' | 'ready' | 'waitingToReconnect' | 'closed'

/** Opt-in multiplayer status. Single player leaves `enabled` false. */
export interface UiNetInfo {
	enabled: boolean
	state: UiNetState
	players: number
	address: string
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
	xp: UiXpInfo
	/** Display name of the dimension the player is in. */
	dimension: string
	farm: UiFarmInfo
	herd: UiHerdInfo
	multiplayer: UiNetInfo
	/** Set while the enchanting screen is open, null otherwise. */
	enchanting: UiEnchantState | null
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
	/** Takes offer `slot` on the open enchanting screen. */
	onTakeEnchantOffer?(slot: number): void
	/** Opt-in multiplayer switch, offered on the pause screen. */
	onToggleMultiplayer?(): void
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
