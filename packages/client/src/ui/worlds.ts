import { button, el, setHidden } from './dom'
import { seedFromText } from './snapshot'
import type { UiPanel, UiSnapshot, UiWorldEntry } from './types'

export interface WorldSelectHost {
  onSelectWorld?(worldId: string): void
  onDeleteWorld?(worldId: string): void
  onCloseScreen?(): void
  onPlaySound?(name: string): void
  /** UiHost has no navigation callback for worldSelect -> worldCreate, so the UI owns it. */
  onRequestCreateScreen(): void
}

export interface WorldCreateHost {
  onCreateWorld?(name: string, seed: number): void
  onPlaySound?(name: string): void
  onRequestSelectScreen(): void
}

function signatureOf(worlds: readonly UiWorldEntry[]): string {
  return worlds.map((w) => `${w.worldId}|${w.name}|${w.seed}|${w.lastPlayedAt}`).join(';')
}

export function createWorldSelectScreen(doc: Document, host: WorldSelectHost): UiPanel {
  const list = el(doc, 'ul', { class: 'vc-world-list', 'data-testid': 'world-list' })
  const emptyNote = el(doc, 'p', { 'data-testid': 'world-list-empty' }, ['No saved worlds yet.'])

  const createButton = button(doc, 'world-select-new', 'Create new world', () => {
    host.onPlaySound?.('ui.click')
    host.onRequestCreateScreen()
  })
  const backButton = button(doc, 'world-select-back', 'Back', () => {
    host.onPlaySound?.('ui.click')
    host.onCloseScreen?.()
  })

  const element = el(
    doc,
    'div',
    { class: 'vc-screen vc-world-select', 'data-testid': 'world-select' },
    [el(doc, 'h2', {}, ['Select world']), list, emptyNote, createButton, backButton],
  )

  let signature = '\u0000'

  const rebuild = (worlds: readonly UiWorldEntry[]): void => {
    list.textContent = ''
    for (const world of worlds) {
      const play = button(doc, `world-play-${world.worldId}`, 'Play', () => {
        host.onPlaySound?.('ui.click')
        host.onSelectWorld?.(world.worldId)
      })
      play.classList.add('is-inline')
      const remove = button(doc, `world-delete-${world.worldId}`, 'Delete', () => {
        host.onPlaySound?.('ui.click')
        host.onDeleteWorld?.(world.worldId)
      })
      remove.classList.add('is-danger')
      list.appendChild(
        el(
          doc,
          'li',
          {
            class: 'vc-world-row',
            'data-testid': `world-entry-${world.worldId}`,
            'data-world-id': world.worldId,
          },
          [
            el(doc, 'span', { class: 'vc-world-name' }, [world.name]),
            el(doc, 'span', { class: 'vc-world-meta' }, [`seed ${world.seed}`]),
            play,
            remove,
          ],
        ),
      )
    }
  }

  return {
    element,
    update(snapshot: UiSnapshot): void {
      setHidden(element, snapshot.screen !== 'worldSelect')
      const next = signatureOf(snapshot.worlds)
      if (next !== signature) {
        signature = next
        rebuild(snapshot.worlds)
      }
      setHidden(list, snapshot.worlds.length === 0)
      setHidden(emptyNote, snapshot.worlds.length > 0)
    },
  }
}

export function createWorldCreateScreen(doc: Document, host: WorldCreateHost): UiPanel {
  const nameInput = el(doc, 'input', {
    type: 'text',
    value: 'New World',
    'data-testid': 'world-create-name',
  })
  const seedInput = el(doc, 'input', {
    type: 'text',
    placeholder: 'leave blank to derive from the name',
    'data-testid': 'world-create-seed',
  })

  const submit = button(doc, 'world-create-submit', 'Create world', () => {
    host.onPlaySound?.('ui.click')
    const name = nameInput.value.trim() || 'New World'
    const raw = seedInput.value.trim()
    const parsed = Number.parseInt(raw, 10)
    const seed = raw.length > 0 && Number.isFinite(parsed) ? parsed | 0 : seedFromText(name)
    host.onCreateWorld?.(name, seed)
  })
  const cancel = button(doc, 'world-create-cancel', 'Cancel', () => {
    host.onPlaySound?.('ui.click')
    host.onRequestSelectScreen()
  })

  const element = el(
    doc,
    'div',
    { class: 'vc-screen vc-world-create', 'data-testid': 'world-create' },
    [
      el(doc, 'h2', {}, ['Create world']),
      el(doc, 'div', { class: 'vc-form' }, [
        el(doc, 'label', { class: 'vc-field' }, [el(doc, 'span', {}, ['World name']), nameInput]),
        el(doc, 'label', { class: 'vc-field' }, [el(doc, 'span', {}, ['Seed']), seedInput]),
      ]),
      submit,
      cancel,
    ],
  )

  return {
    element,
    update(snapshot: UiSnapshot): void {
      setHidden(element, snapshot.screen !== 'worldCreate')
    },
  }
}
