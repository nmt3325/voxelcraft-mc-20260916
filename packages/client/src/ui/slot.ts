import { el, setAttr, setHidden, setText, toggleClass } from './dom'
import { filledSlot } from './snapshot'
import type { UiSlot } from './types'

export interface SlotView {
  element: HTMLElement
  update(slot: UiSlot | null): void
  setSelected(selected: boolean): void
}

/** One inventory / hotbar / crafting cell. Text only: the atlas lives on the canvas. */
export function createSlotView(doc: Document, testId: string, index: number): SlotView {
  const label = el(doc, 'span', { class: 'vc-slot-label' })
  const count = el(doc, 'span', { class: 'vc-slot-count' })
  const durability = el(doc, 'span', { class: 'vc-slot-durability' })
  const track = el(doc, 'span', { class: 'vc-slot-durability-track' }, [durability])
  const element = el(
    doc,
    'div',
    {
      class: 'vc-slot is-empty',
      'data-testid': testId,
      'data-index': index,
      'data-item-id': 0,
      role: 'button',
      tabindex: '-1',
    },
    [label, count, track],
  )
  setHidden(track, true)

  return {
    element,
    update(slot: UiSlot | null): void {
      const filled = filledSlot(slot)
      toggleClass(element, 'is-empty', filled === null)
      setText(label, filled ? filled.label : '')
      setText(count, filled && filled.count > 1 ? String(filled.count) : '')
      setAttr(element, 'data-item-id', String(filled ? filled.itemId : 0))
      setAttr(element, 'data-count', String(filled ? filled.count : 0))
      const wear = filled ? filled.durability : null
      setHidden(track, wear === null)
      if (wear !== null) {
        const pct = Math.max(0, Math.min(1, wear)) * 100
        setAttr(durability, 'style', `width:${pct.toFixed(1)}%`)
      }
    },
    setSelected(selected: boolean): void {
      toggleClass(element, 'is-selected', selected)
      setAttr(element, 'aria-selected', selected ? 'true' : 'false')
    },
  }
}
