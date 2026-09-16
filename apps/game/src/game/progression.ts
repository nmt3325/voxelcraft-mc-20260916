/**
 * Player progression: experience, farming and the enchanting table.
 *
 * None of the rules live here. `@voxelcraft/gameplay` owns the XP curve, the
 * orb pool, tilling, planting, the deterministic growth roll, harvest drops,
 * bookshelf counting and the offer rolls. This module only holds the state the
 * app must keep between frames (the XP total, the orb pool, the crop field, the
 * open table) and adapts it to what the UI and the input handlers need.
 *
 * Crop growth runs with assumed full light, because the app does not expose a
 * block light lookup yet. Every other input of the roll is the seed, the tick
 * and the position, so a fixed seed replays identically.
 */
import {
	ENCHANTING,
	ITEM,
	TOOL_CLASS,
	type BlockId,
	type EventBusV2,
	type InventoryState,
	type ItemId,
	type ItemStack,
	type ToolClass,
} from '@voxelcraft/core-types'
import {
	MAX_CROP_STAGE,
	addStack,
	applyOffer,
	canAfford,
	collectOrbs,
	countBookshelves,
	countItem,
	createCropField,
	createOrbPool,
	createTrampleTracker,
	createXpState,
	cropCount,
	cropEntries,
	dropBlockBreakXp,
	harvestCrop,
	heldStack,
	lapisCostOf,
	levelProgress,
	orbCount,
	plantCrop,
	randomTickCrops,
	removeCrop,
	removeItem,
	rollOffers,
	setHeldStack,
	tickOrbs,
	tillSoil,
	trampleFarmland,
	updateFarmland,
	xpForBlockBreak,
	type CropField,
	type EnchantOffer,
	type EnchantWorld,
	type EnchantmentSet,
	type FarmWorld,
	type OrbPool,
	type TrampleTracker,
	type XpState,
} from '@voxelcraft/gameplay'
import { ITEMS_V2, V2_INVENTORY, itemDisplayName } from '../registries'

/** Effects the app turns into particles and sounds. */
export type ProgressionEffect = 'xp-pickup' | 'crop-grown' | 'crop-harvest' | 'enchant'

export interface ProgressionOptions {
	/** World seed, so growth and offers replay with the world. */
	seed: number
	/** v2 event bus. XP, growth and enchanting emit on it. */
	events: EventBusV2
	onEffect?: (effect: ProgressionEffect, x: number, y: number, z: number) => void
}

/** The enchanting table the player has open. */
export interface EnchantSession {
	x: number
	y: number
	z: number
	bookshelves: number
	offers: readonly EnchantOffer[]
	message: string
}

export interface XpInfo {
	level: number
	progress: number
	total: number
	orbs: number
}

export interface FarmInfo {
	crops: number
	mature: number
}

export interface EnchantOfferInfo {
	slot: number
	levelCost: number
	lapisCost: number
	label: string
	affordable: boolean
}

export interface EnchantInfo {
	bookshelves: number
	lapis: number
	itemLabel: string
	offers: readonly EnchantOfferInfo[]
	message: string
}

const ROMAN: readonly string[] = ['', 'I', 'II', 'III', 'IV', 'V']

function prettyId(id: string): string {
	return id
		.split(/[_\s-]+/)
		.filter((part) => part.length > 0)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ')
}

function offerLabel(offer: EnchantOffer): string {
	if (offer.enchantments.length === 0) return 'Nothing on offer'
	return offer.enchantments
		.map((entry) => {
			const level = ROMAN[entry.level] ?? String(entry.level)
			return `${prettyId(String(entry.id))} ${level}`.trim()
		})
		.join(', ')
}

/** Tool class of the held item, which decides what a table may offer. */
function toolClassOf(stack: ItemStack | null): ToolClass {
	if (stack === null) return TOOL_CLASS.None
	return ITEMS_V2.tryById(stack.item)?.toolClass ?? TOOL_CLASS.None
}

/** Table seed: the same table always shows the same three rolls. */
function tableSeed(seed: number, x: number, y: number, z: number): number {
	return (seed ^ (x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0
}

export interface Progression {
	readonly xp: XpState
	readonly orbs: OrbPool
	readonly field: CropField
	readonly trample: TrampleTracker
	/** Open table, or null when no enchanting screen is up. */
	readonly session: EnchantSession | null
	/** Drops orbs for an ore break. Returns the experience released. */
	blockBroken(x: number, y: number, z: number, id: BlockId): number
	/** Picks up nearby orbs. Returns the experience collected. */
	collectAt(x: number, y: number, z: number): number
	/** One simulation tick of growth and orb ageing. Returns crops grown. */
	tick(world: FarmWorld, tick: number): number
	till(world: FarmWorld, x: number, y: number, z: number, held: ItemStack | null): boolean
	plant(world: FarmWorld, x: number, y: number, z: number, seed: ItemId): boolean
	/** Harvests a crop into the inventory. Returns what it dropped. */
	harvest(world: FarmWorld, inventory: InventoryState, x: number, y: number, z: number): ItemStack[]
	/** Re-reads hydration of a farmland block after a world edit. */
	hydrate(world: FarmWorld, x: number, y: number, z: number): void
	/** Counts a fall onto farmland, which may trample it back to dirt. */
	trampled(world: FarmWorld, x: number, y: number, z: number, falls: number): boolean
	openTable(
		world: EnchantWorld,
		inventory: InventoryState,
		x: number,
		y: number,
		z: number,
	): boolean
	takeOffer(inventory: InventoryState, slot: number): boolean
	closeTable(): void
	xpInfo(): XpInfo
	farmInfo(): FarmInfo
	enchantInfo(inventory: InventoryState): EnchantInfo | null
}

export function createProgression(options: ProgressionOptions): Progression {
	const xp = createXpState()
	const orbs = createOrbPool()
	const field = createCropField()
	const trample = createTrampleTracker()
	// Enchantments an item carries. `ItemStack` has no room for them, so they
	// are tracked per hotbar slot, which is what the player sees anyway.
	const sets = new Map<number, EnchantmentSet>()
	const bus = options.events
	let session: EnchantSession | null = null

	const effect = (kind: ProgressionEffect, x: number, y: number, z: number): void => {
		options.onEffect?.(kind, x, y, z)
	}

	return {
		xp,
		orbs,
		field,
		trample,
		get session(): EnchantSession | null {
			return session
		},
		blockBroken(x, y, z, id): number {
			dropBlockBreakXp(orbs, x + 0.5, y + 0.5, z + 0.5, id)
			return xpForBlockBreak(id)
		},
		collectAt(x, y, z): number {
			if (orbCount(orbs) === 0) return 0
			const pickup = collectOrbs(orbs, x, y, z, xp, bus)
			if (pickup.collected > 0) effect('xp-pickup', x, y, z)
			return pickup.collected
		},
		tick(world, tick): number {
			tickOrbs(orbs, 1)
			if (cropCount(field) === 0) return 0
			const grown = randomTickCrops(field, world, { seed: options.seed, tick, bus })
			for (const entry of grown) effect('crop-grown', entry.x, entry.y, entry.z)
			return grown.length
		},
		till(world, x, y, z, held): boolean {
			if (!tillSoil(world, x, y, z, held)) return false
			updateFarmland(world, x, y, z)
			return true
		},
		plant(world, x, y, z, seed): boolean {
			return plantCrop(field, world, x, y, z, seed)
		},
		harvest(world, inventory, x, y, z): ItemStack[] {
			const result = harvestCrop(field, world, x, y, z)
			if (result === null) return []
			const dropped: ItemStack[] = []
			for (const stack of result.drops) {
				if (stack.count <= 0) continue
				const copy: ItemStack = { item: stack.item, count: stack.count, damage: stack.damage }
				addStack(inventory, copy, V2_INVENTORY)
				dropped.push({ item: stack.item, count: stack.count, damage: stack.damage })
			}
			effect('crop-harvest', x, y, z)
			return dropped
		},
		hydrate(world, x, y, z): void {
			updateFarmland(world, x, y, z)
		},
		trampled(world, x, y, z, falls): boolean {
			const result = trampleFarmland(world, x, y, z, falls, {
				tracker: trample,
				onCropCleared: (cx, cy, cz) => {
					removeCrop(field, cx, cy, cz)
				},
			})
			return result.reverted
		},
		openTable(world, inventory, x, y, z): boolean {
			const bookshelves = countBookshelves(world, x, y, z)
			session = {
				x,
				y,
				z,
				bookshelves,
				offers: rollOffers({
					seed: tableSeed(options.seed, x, y, z),
					bookshelves,
					toolClass: toolClassOf(heldStack(inventory)),
				}),
				message: '',
			}
			return true
		},
		takeOffer(inventory, slot): boolean {
			const open = session
			if (open === null) return false
			const offer = open.offers[slot]
			if (offer === undefined) return false
			const index = inventory.selectedHotbar
			const result = applyOffer(xp, heldStack(inventory), offer, {
				lapis: countItem(inventory, ITEM.LAPIS),
				bus,
				set: sets.get(index),
			})
			if (!result.ok) {
				session = { ...open, message: `Cannot enchant: ${result.reason ?? 'unavailable'}` }
				return false
			}
			removeItem(inventory, ITEM.LAPIS, offer.lapisCost)
			setHeldStack(inventory, result.stack)
			sets.set(index, result.set)
			session = { ...open, message: `Enchanted with ${offerLabel(offer)}` }
			effect('enchant', open.x, open.y, open.z)
			return true
		},
		closeTable(): void {
			session = null
		},
		xpInfo(): XpInfo {
			return {
				level: xp.level,
				progress: levelProgress(xp.total),
				total: xp.total,
				orbs: orbCount(orbs),
			}
		},
		farmInfo(): FarmInfo {
			let mature = 0
			for (const entry of cropEntries(field)) {
				if (entry.stage >= MAX_CROP_STAGE) mature += 1
			}
			return { crops: cropCount(field), mature }
		},
		enchantInfo(inventory): EnchantInfo | null {
			const open = session
			if (open === null) return null
			const lapis = countItem(inventory, ITEM.LAPIS)
			const held = heldStack(inventory)
			return {
				bookshelves: open.bookshelves,
				lapis,
				itemLabel: held === null ? '' : itemDisplayName(held.item),
				message: open.message,
				offers: open.offers.map((offer) => ({
					slot: offer.slot,
					levelCost: offer.levelCost,
					lapisCost: offer.lapisCost,
					label: offerLabel(offer),
					affordable: held !== null && lapis >= offer.lapisCost && canAfford(xp, offer.levelCost),
				})),
			}
		},
	}
}

/** Lapis an offer slot costs, for the UI. */
export function offerLapisCost(slot: number): number {
	return lapisCostOf(slot)
}

/** Offer slots a table shows. */
export const OFFER_SLOTS = ENCHANTING.offerSlots
