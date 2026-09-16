import { INVENTORY } from '@voxelcraft/core-types'
import { el, percent, setAttr, setHidden, setText } from './dom'
import { createSlotView, type SlotView } from './slot'
import type { UiPanel, UiSnapshot } from './types'

const HUD_SCREENS = new Set(['playing', 'inventory', 'pause'])

export interface HudHost {
	onSelectHotbar?(index: number): void
	onPlaySound?(name: string): void
}

export function createHud(doc: Document, host: HudHost): UiPanel {
	const crosshair = el(doc, 'div', { class: 'vc-crosshair', 'data-testid': 'crosshair' })

	const healthFill = el(doc, 'span', { class: 'vc-bar-fill' })
	const healthLabel = el(doc, 'span', { class: 'vc-bar-label' })
	const health = el(doc, 'div', { class: 'vc-bar vc-bar-health', 'data-testid': 'health' }, [
		healthFill,
		healthLabel,
	])

	const hungerFill = el(doc, 'span', { class: 'vc-bar-fill' })
	const hungerLabel = el(doc, 'span', { class: 'vc-bar-label' })
	const hunger = el(doc, 'div', { class: 'vc-bar vc-bar-hunger', 'data-testid': 'hunger' }, [
		hungerFill,
		hungerLabel,
	])

	const xpFill = el(doc, 'span', { class: 'vc-bar-fill' })
	const xpLabel = el(doc, 'span', { class: 'vc-bar-label', 'data-testid': 'xp-level' })
	const xp = el(doc, 'div', { class: 'vc-bar vc-bar-xp', 'data-testid': 'xp' }, [xpFill, xpLabel])

	const hotbar = el(doc, 'div', { class: 'vc-hotbar', 'data-testid': 'hotbar' })
	const slots: SlotView[] = []
	for (let i = 0; i < INVENTORY.hotbarSlots; i++) {
		const view = createSlotView(doc, `hotbar-slot-${i}`, i)
		view.element.addEventListener('click', () => {
			host.onPlaySound?.('ui.click')
			host.onSelectHotbar?.(i)
		})
		slots.push(view)
		hotbar.appendChild(view.element)
	}

	const element = el(doc, 'div', { class: 'vc-hud', 'data-testid': 'hud' }, [
		crosshair,
		el(doc, 'div', { class: 'vc-stats' }, [health, hunger, xp]),
		hotbar,
	])

	return {
		element,
		update(snapshot: UiSnapshot): void {
			setHidden(element, !HUD_SCREENS.has(snapshot.screen))
			setHidden(crosshair, snapshot.screen !== 'playing')

			setText(healthLabel, `${Math.round(snapshot.health)} / ${Math.round(snapshot.maxHealth)}`)
			setAttr(
				healthFill,
				'style',
				`width:${percent(snapshot.health, snapshot.maxHealth).toFixed(1)}%`,
			)
			setText(hungerLabel, `${Math.round(snapshot.hunger)} / ${Math.round(snapshot.maxHunger)}`)
			setAttr(
				hungerFill,
				'style',
				`width:${percent(snapshot.hunger, snapshot.maxHunger).toFixed(1)}%`,
			)
			const level = Math.max(0, Math.round(snapshot.xp.level))
			const total = Math.max(0, Math.round(snapshot.xp.total))
			setText(xpLabel, `Lvl ${level} - ${total} xp`)
			setAttr(xpFill, 'style', `width:${percent(snapshot.xp.progress, 1).toFixed(1)}%`)
			setAttr(xp, 'data-level', String(level))
			setAttr(xp, 'data-total', String(total))
			setAttr(xp, 'data-orbs', String(Math.max(0, Math.round(snapshot.xp.orbs))))

			for (let i = 0; i < slots.length; i++) {
				slots[i].update(snapshot.hotbar[i] ?? null)
				slots[i].setSelected(i === snapshot.selectedSlot)
			}
		},
	}
}
