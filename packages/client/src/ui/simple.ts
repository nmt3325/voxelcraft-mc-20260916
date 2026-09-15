import { button, el, setHidden } from './dom'
import type { UiPanel, UiScreen, UiSnapshot } from './types'

export function createMessageScreen(
  doc: Document,
  screen: UiScreen,
  testId: string,
  title: string,
  message: string,
): UiPanel {
  const element = el(doc, 'div', { class: 'vc-screen', 'data-testid': testId }, [
    el(doc, 'h2', {}, [title]),
    el(doc, 'p', {}, [message]),
  ])
  return {
    element,
    update(snapshot: UiSnapshot): void {
      setHidden(element, snapshot.screen !== screen)
    },
  }
}

export interface TitleHost {
  onCloseScreen?(): void
  onOpenSettings?(): void
  onPlaySound?(name: string): void
}

export function createTitleScreen(doc: Document, host: TitleHost): UiPanel {
  const element = el(doc, 'div', { class: 'vc-screen vc-title', 'data-testid': 'title-screen' }, [
    el(doc, 'h2', {}, ['VoxelCraft']),
    button(doc, 'title-play', 'Singleplayer', () => {
      host.onPlaySound?.('ui.click')
      host.onCloseScreen?.()
    }),
    button(doc, 'title-settings', 'Settings', () => {
      host.onPlaySound?.('ui.click')
      host.onOpenSettings?.()
    }),
  ])
  return {
    element,
    update(snapshot: UiSnapshot): void {
      setHidden(element, snapshot.screen !== 'title')
    },
  }
}
