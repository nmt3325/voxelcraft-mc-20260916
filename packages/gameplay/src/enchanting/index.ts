/**
 * Enchanting: enchantment sets, the enchanting table's offers and the effects
 * those enchantments have on mining, drops, durability and combat.
 */

export {
	ENCHANTMENT_IDS,
	addEnchantment,
	applicableEnchantments,
	canApplyTo,
	clampEnchantLevel,
	conflictsWith,
	hasEnchantment,
	levelOf,
	maxLevelOf,
	type EnchantmentSet,
} from './enchantments'

export {
	applyOffer,
	clampBookshelves,
	clampSlot,
	countBookshelves,
	lapisCostOf,
	rollOffers,
	type ApplyOfferOptions,
	type ApplyOfferResult,
	type EnchantOffer,
	type EnchantWorld,
	type RollOffersInput,
} from './offers'

export {
	arrowDamage,
	consumeDurability,
	durabilityConsumed,
	efficiencyMultiplier,
	enchantedBreakTime,
	enchantedDrops,
	fortuneBonus,
	meleeDamage,
	reduceDamage,
	sharpnessBonus,
} from './effects'
