import { ENCHANTING } from '@voxelcraft/core-types'
import { button, el, setAttr, setHidden, setText } from './dom'
import type { UiEnchantState, UiPanel, UiSnapshot } from './types'

export interface EnchantingHost {
	onTakeEnchantOffer?(slot: number): void
	onCloseScreen?(): void
	onPlaySound?(name: string): void
}

interface OfferRow {
	element: HTMLElement
	name: HTMLElement
	cost: HTMLElement
	take: HTMLButtonElement
}

const EMPTY_STATE: UiEnchantState = {
	bookshelves: 0,
	lapis: 0,
	itemLabel: '',
	offers: [],
	message: '',
}

/**
 * The enchanting table screen: the three rolled offers, what each one costs and
 * how much power the surrounding bookshelves give. The rolls themselves come
 * from `@voxelcraft/gameplay`; this panel only renders them and reports which
 * offer the player took.
 */
export function createEnchantingScreen(doc: Document, host: EnchantingHost): UiPanel {
	const rows: OfferRow[] = []
	const list = el(doc, 'ul', { class: 'vc-enchant-list', 'data-testid': 'enchant-offers' })
	for (let slot = 0; slot < ENCHANTING.offerSlots; slot++) {
		const name = el(doc, 'span', {
			class: 'vc-enchant-name',
			'data-testid': `enchant-name-${slot}`,
		})
		const cost = el(doc, 'span', {
			class: 'vc-enchant-cost',
			'data-testid': `enchant-cost-${slot}`,
		})
		const take = button(doc, `enchant-offer-${slot}`, 'Enchant', () => {
			host.onPlaySound?.('ui.click')
			host.onTakeEnchantOffer?.(slot)
		})
		take.classList.add('is-inline')
		const element = el(
			doc,
			'li',
			{ class: 'vc-enchant-row', 'data-testid': `enchant-row-${slot}` },
			[name, cost, take],
		)
		rows.push({ element, name, cost, take })
		list.appendChild(element)
	}

	const item = el(doc, 'p', { class: 'vc-enchant-meta', 'data-testid': 'enchant-item' })
	const power = el(doc, 'p', { class: 'vc-enchant-meta', 'data-testid': 'enchant-power' })
	const message = el(doc, 'p', { class: 'vc-enchant-meta', 'data-testid': 'enchant-message' })
	const close = button(doc, 'enchanting-close', 'Close', () => {
		host.onPlaySound?.('ui.click')
		host.onCloseScreen?.()
	})

	const element = el(
		doc,
		'div',
		{ class: 'vc-screen vc-enchanting', 'data-testid': 'enchanting-screen' },
		[el(doc, 'h2', {}, ['Enchanting Table']), item, power, list, message, close],
	)

	return {
		element,
		update(snapshot: UiSnapshot): void {
			setHidden(element, snapshot.screen !== 'enchanting')
			const state = snapshot.enchanting ?? EMPTY_STATE
			setText(item, state.itemLabel === '' ? 'Hold an item to enchant' : `Item ${state.itemLabel}`)
			setText(
				power,
				`Bookshelves ${state.bookshelves} / ${ENCHANTING.maxBookshelves} - Lapis ${state.lapis}`,
			)
			setText(message, state.message)
			setAttr(element, 'data-bookshelves', String(state.bookshelves))
			for (let slot = 0; slot < rows.length; slot++) {
				const row = rows[slot]
				const offer = state.offers[slot]
				if (offer === undefined) {
					setHidden(row.element, true)
					continue
				}
				setHidden(row.element, false)
				setText(row.name, offer.label === '' ? 'Nothing on offer' : offer.label)
				setText(row.cost, `${offer.levelCost} levels - ${offer.lapisCost} lapis`)
				row.take.disabled = !offer.affordable
				setAttr(row.element, 'data-affordable', offer.affordable ? 'true' : 'false')
				setAttr(row.element, 'data-level-cost', String(offer.levelCost))
			}
		},
	}
}
