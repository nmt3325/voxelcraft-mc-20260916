import { createDebugOverlay } from './debug'
import { el } from './dom'
import { createHud } from './hud'
import { createInventoryScreen } from './inventory'
import { createPauseScreen } from './pause'
import { createSettingsScreen } from './settings'
import { createMessageScreen, createTitleScreen } from './simple'
import { createDefaultUiSnapshot } from './snapshot'
import { createStyleElement } from './styles'
import type { UiHandle, UiHost, UiPanel, UiScreen, UiSnapshot } from './types'
import { createWorldCreateScreen, createWorldSelectScreen } from './worlds'

export type {
  UiDebugInfo,
  UiHandle,
  UiHost,
  UiPanel,
  UiScreen,
  UiSettings,
  UiSlot,
  UiSnapshot,
  UiWorldEntry,
} from './types'
export { createDefaultUiSnapshot, EMPTY_SLOT, filledSlot, seedFromText } from './snapshot'
export { UI_CSS, UI_STYLE_ID } from './styles'

const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

function isTextEntry(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null
  if (!node || typeof node !== 'object') return false
  if (node.isContentEditable) return true
  return typeof node.tagName === 'string' && TEXT_ENTRY_TAGS.has(node.tagName)
}

/**
 * Mounts the whole UI under `root`. Nothing outside `root` is touched, except a
 * single keydown listener on the owning window which `dispose()` removes again.
 */
export function createUi(root: HTMLElement, host: UiHost): UiHandle {
  const doc = root.ownerDocument
  const view = doc.defaultView

  const container = el(doc, 'div', { class: 'vc-ui', 'data-testid': 'ui-layer' })
  container.appendChild(createStyleElement(doc))

  const panels: UiPanel[] = []
  let snapshot: UiSnapshot = createDefaultUiSnapshot()
  let hostScreen: UiScreen = snapshot.screen
  /** Local-only navigation (worldSelect <-> worldCreate); cleared whenever the host moves. */
  let override: UiScreen | null = null

  const render = (): void => {
    const current = override === null ? snapshot : { ...snapshot, screen: override }
    for (const panel of panels) panel.update(current)
  }

  const requestScreen = (screen: UiScreen | null): void => {
    override = screen
    render()
  }

  const add = (panel: UiPanel): void => {
    panels.push(panel)
    container.appendChild(panel.element)
  }

  add(createHud(doc, host))
  add(createDebugOverlay(doc))
  add(createMessageScreen(doc, 'loading', 'loading-screen', 'Loading', 'Generating terrain...'))
  add(createTitleScreen(doc, host))
  add(createInventoryScreen(doc, host))
  add(createPauseScreen(doc, host))
  add(createSettingsScreen(doc, host))
  add(
    createWorldSelectScreen(doc, {
      onSelectWorld: (worldId) => host.onSelectWorld?.(worldId),
      onDeleteWorld: (worldId) => host.onDeleteWorld?.(worldId),
      onCloseScreen: () => host.onCloseScreen?.(),
      onPlaySound: (name) => host.onPlaySound?.(name),
      onRequestCreateScreen: () => requestScreen('worldCreate'),
    }),
  )
  add(
    createWorldCreateScreen(doc, {
      onCreateWorld: (name, seed) => {
        override = null
        host.onCreateWorld?.(name, seed)
      },
      onPlaySound: (name) => host.onPlaySound?.(name),
      onRequestSelectScreen: () => requestScreen(null),
    }),
  )

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || isTextEntry(event.target)) return
    const key = event.key

    if (key === 'e' || key === 'E') {
      event.preventDefault()
      host.onPlaySound?.('ui.click')
      host.onToggleInventory?.()
      return
    }
    if (key === 'Escape') {
      host.onPlaySound?.('ui.click')
      if (override !== null) {
        requestScreen(null)
        return
      }
      host.onCloseScreen?.()
      return
    }
    if (key === 'F3') {
      event.preventDefault()
      host.onChangeSetting?.('showDebug', !snapshot.settings.showDebug)
      return
    }
    if (key.length === 1 && key >= '1' && key <= '9') {
      event.preventDefault()
      host.onPlaySound?.('ui.click')
      host.onSelectHotbar?.(Number(key) - 1)
    }
  }

  view?.addEventListener('keydown', onKeyDown)
  root.appendChild(container)
  render()

  return {
    element: container,
    update(next: UiSnapshot): void {
      if (next.screen !== hostScreen) {
        hostScreen = next.screen
        override = null
      }
      snapshot = next
      render()
    },
    dispose(): void {
      view?.removeEventListener('keydown', onKeyDown)
      for (const panel of panels) panel.dispose?.()
      panels.length = 0
      container.remove()
    },
  }
}
