import { INVENTORY } from '@voxelcraft/core-types'
import { button, el, setAttr, setHidden } from './dom'
import { createSlotView, type SlotView } from './slot'
import type { UiPanel, UiSnapshot } from './types'

export interface InventoryHost {
  onMoveStack?(from: number, to: number): void
  onCraft?(): void
  onCloseScreen?(): void
  onPlaySound?(name: string): void
}

/**
 * 36 inventory slots plus the crafting grid. Moving a stack is click-to-pick /
 * click-to-drop, which works with a pointer, a touch screen and Playwright alike.
 */
export function createInventoryScreen(doc: Document, host: InventoryHost): UiPanel {
  const slots: SlotView[] = []
  let pending = -1

  const clearPending = (): void => {
    if (pending >= 0) slots[pending]?.setSelected(false)
    pending = -1
  }

  const grid = el(doc, 'div', { class: 'vc-inv-grid', 'data-testid': 'inventory-grid' })
  for (let i = 0; i < INVENTORY.totalSlots; i++) {
    const view = createSlotView(doc, `inventory-slot-${i}`, i)
    view.element.addEventListener('click', () => {
      host.onPlaySound?.('ui.click')
      if (pending < 0) {
        pending = i
        view.setSelected(true)
        return
      }
      if (pending === i) {
        clearPending()
        return
      }
      const from = pending
      clearPending()
      host.onMoveStack?.(from, i)
    })
    slots.push(view)
    grid.appendChild(view.element)
  }

  const craftingGrid = el(doc, 'div', {
    class: 'vc-craft-grid',
    'data-testid': 'crafting-grid',
    'data-grid-size': 3,
  })
  const craftCells: SlotView[] = []
  for (let i = 0; i < INVENTORY.craftGrid3; i++) {
    const view = createSlotView(doc, `crafting-cell-${i}`, i)
    craftCells.push(view)
    craftingGrid.appendChild(view.element)
  }

  const result = createSlotView(doc, 'crafting-result', 0)
  const craftButton = button(doc, 'craft-button', 'Craft', () => {
    host.onPlaySound?.('ui.click')
    host.onCraft?.()
  })
  craftButton.classList.add('is-inline')

  const closeButton = button(doc, 'inventory-close', 'Close', () => {
    host.onPlaySound?.('ui.click')
    clearPending()
    host.onCloseScreen?.()
  })

  const element = el(
    doc,
    'div',
    { class: 'vc-screen vc-inventory', 'data-testid': 'inventory-screen' },
    [
      el(doc, 'h2', {}, ['Inventory']),
      el(doc, 'div', { class: 'vc-craft' }, [
        craftingGrid,
        el(doc, 'span', { class: 'vc-craft-arrow' }, ['=>']),
        result.element,
        craftButton,
      ]),
      grid,
      closeButton,
    ],
  )

  return {
    element,
    update(snapshot: UiSnapshot): void {
      const visible = snapshot.screen === 'inventory'
      setHidden(element, !visible)
      if (!visible) clearPending()

      for (let i = 0; i < slots.length; i++) {
        slots[i].update(snapshot.inventory[i] ?? null)
      }

      const size = snapshot.craftingGrid.length <= INVENTORY.craftGrid2 ? 2 : 3
      setAttr(craftingGrid, 'data-grid-size', String(size))
      for (let i = 0; i < craftCells.length; i++) {
        const used = i < size * size
        setHidden(craftCells[i].element, !used)
        craftCells[i].update(used ? (snapshot.craftingGrid[i] ?? null) : null)
      }
      result.update(snapshot.craftingResult)
    },
  }
}
