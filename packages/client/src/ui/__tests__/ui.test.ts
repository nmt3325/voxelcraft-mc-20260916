// @vitest-environment jsdom
import { INVENTORY, PERF } from '@voxelcraft/core-types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createUi } from '../index'
import { createDefaultUiSnapshot } from '../snapshot'
import type { UiHandle, UiScreen, UiSlot, UiSnapshot } from '../types'

function createHostSpy() {
  return {
    onSelectHotbar: vi.fn(),
    onToggleInventory: vi.fn(),
    onCloseScreen: vi.fn(),
    onResume: vi.fn(),
    onOpenSettings: vi.fn(),
    onChangeSetting: vi.fn(),
    onCreateWorld: vi.fn(),
    onSelectWorld: vi.fn(),
    onDeleteWorld: vi.fn(),
    onSave: vi.fn(),
    onQuit: vi.fn(),
    onCraft: vi.fn(),
    onMoveStack: vi.fn(),
    onPlaySound: vi.fn(),
  }
}

function stack(itemId: number, count: number, label: string): UiSlot {
  return { itemId, count, durability: null, label }
}

let root: HTMLElement
let host: ReturnType<typeof createHostSpy>
let ui: UiHandle

function find(testId: string): HTMLElement {
  const node = root.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  if (node === null) throw new Error(`missing [data-testid="${testId}"]`)
  return node
}

function snapshotFor(screen: UiScreen, overrides: Partial<UiSnapshot> = {}): UiSnapshot {
  return { ...createDefaultUiSnapshot(), screen, ...overrides }
}

function press(key: string, target: EventTarget = window): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

beforeEach(() => {
  document.body.textContent = ''
  root = document.createElement('div')
  root.id = 'ui-root'
  document.body.appendChild(root)
  host = createHostSpy()
  ui = createUi(root, host)
})

afterEach(() => {
  ui.dispose()
  document.body.textContent = ''
})

describe('createUi mounting', () => {
  it('renders every required test id under the root only', () => {
    for (const testId of [
      'hud',
      'crosshair',
      'hotbar',
      'health',
      'hunger',
      'debug-overlay',
      'inventory-screen',
      'crafting-grid',
      'pause-screen',
      'settings-screen',
      'world-select',
      'world-create',
    ]) {
      expect(find(testId)).toBeTruthy()
    }
    expect(document.body.children.length).toBe(1)
    expect(ui.element.parentElement).toBe(root)
  })

  it('builds one hotbar slot per contract slot', () => {
    expect(find('hotbar').children.length).toBe(INVENTORY.hotbarSlots)
    for (let i = 0; i < INVENTORY.hotbarSlots; i++) {
      expect(find(`hotbar-slot-${i}`)).toBeTruthy()
    }
  })

  it('builds 36 inventory slots and a 3x3 crafting grid', () => {
    expect(find('inventory-grid').children.length).toBe(INVENTORY.totalSlots)
    expect(find('crafting-grid').children.length).toBe(INVENTORY.craftGrid3)
    expect(find('crafting-result')).toBeTruthy()
  })

  it('starts on the loading screen with the hud hidden', () => {
    expect(find('loading-screen').hidden).toBe(false)
    expect(find('hud').hidden).toBe(true)
  })
})

describe('hud updates', () => {
  it('writes health, hunger and the selected hotbar slot', () => {
    ui.update(
      snapshotFor('playing', {
        health: 7,
        maxHealth: 20,
        hunger: 13,
        maxHunger: 20,
        selectedSlot: 2,
        hotbar: [
          stack(1, 12, 'Stone'),
          stack(4, 1, 'Grass Block'),
          stack(3, 64, 'Dirt'),
          ...createDefaultUiSnapshot().hotbar.slice(3),
        ],
      }),
    )

    expect(find('hud').hidden).toBe(false)
    expect(find('crosshair').hidden).toBe(false)
    expect(find('health').textContent).toContain('7 / 20')
    expect(find('hunger').textContent).toContain('13 / 20')
    expect(find('hotbar-slot-0').textContent).toContain('Stone')
    expect(find('hotbar-slot-0').textContent).toContain('12')
    expect(find('hotbar-slot-1').textContent).not.toContain('1\u00a0')
    expect(find('hotbar-slot-2').classList.contains('is-selected')).toBe(true)
    expect(find('hotbar-slot-0').classList.contains('is-selected')).toBe(false)
  })

  it('hides the crosshair while a screen is open', () => {
    ui.update(snapshotFor('inventory'))
    expect(find('hud').hidden).toBe(false)
    expect(find('crosshair').hidden).toBe(true)
  })

  it('is safe to call update repeatedly with the same snapshot', () => {
    const snapshot = snapshotFor('playing', { health: 11 })
    ui.update(snapshot)
    ui.update(snapshot)
    ui.update(snapshot)
    expect(find('health').textContent).toContain('11 / 20')
  })
})

describe('screen transitions', () => {
  it('shows exactly the requested screen', () => {
    const cases: Array<[UiScreen, string]> = [
      ['loading', 'loading-screen'],
      ['title', 'title-screen'],
      ['worldSelect', 'world-select'],
      ['worldCreate', 'world-create'],
      ['inventory', 'inventory-screen'],
      ['pause', 'pause-screen'],
      ['settings', 'settings-screen'],
    ]
    for (const [screen, testId] of cases) {
      ui.update(snapshotFor(screen))
      expect(find(testId).hidden, `${testId} should be visible on ${screen}`).toBe(false)
      for (const [other, otherId] of cases) {
        if (other === screen) continue
        expect(find(otherId).hidden, `${otherId} should be hidden on ${screen}`).toBe(true)
      }
    }
  })

  it('navigates locally from world select to world create', () => {
    ui.update(snapshotFor('worldSelect'))
    find('world-select-new').click()
    expect(find('world-create').hidden).toBe(false)
    expect(find('world-select').hidden).toBe(true)

    find('world-create-cancel').click()
    expect(find('world-select').hidden).toBe(false)
  })
})

describe('debug overlay', () => {
  it('is hidden unless showDebug is enabled', () => {
    ui.update(snapshotFor('playing'))
    expect(find('debug-overlay').hidden).toBe(true)
  })

  it('renders fps, position and render statistics', () => {
    const base = createDefaultUiSnapshot()
    ui.update(
      snapshotFor('playing', {
        settings: { ...base.settings, showDebug: true },
        debug: {
          ...base.debug,
          fps: 59.6,
          x: 12.25,
          y: 71.5,
          z: -8.75,
          biome: 'Forest',
          chunks: 25,
          drawCalls: 7,
          quads: 1234,
          triangles: 2468,
          renderDistance: 2,
        },
      }),
    )
    const overlay = find('debug-overlay')
    expect(overlay.hidden).toBe(false)
    expect(find('debug-fps').textContent).toBe('FPS 60')
    expect(find('debug-pos').textContent).toBe('XYZ 12.25 / 71.50 / -8.75')
    expect(find('debug-biome').textContent).toBe('Biome Forest')
    expect(find('debug-chunks').textContent).toBe('Chunks 25')
    expect(find('debug-draws').textContent).toBe('Draw calls 7')
    expect(find('debug-geometry').textContent).toBe('Quads 1234 Tris 2468')
    expect(find('debug-render-distance').textContent).toBe('Render distance 2')
  })
})

describe('pointer input', () => {
  it('reports hotbar clicks', () => {
    ui.update(snapshotFor('playing'))
    find('hotbar-slot-3').click()
    expect(host.onSelectHotbar).toHaveBeenCalledWith(3)
    expect(host.onPlaySound).toHaveBeenCalledWith('ui.click')
  })

  it('reports crafting and stack moves from the inventory screen', () => {
    ui.update(snapshotFor('inventory'))
    find('craft-button').click()
    expect(host.onCraft).toHaveBeenCalledTimes(1)

    find('inventory-slot-0').click()
    expect(find('inventory-slot-0').classList.contains('is-selected')).toBe(true)
    find('inventory-slot-5').click()
    expect(host.onMoveStack).toHaveBeenCalledWith(0, 5)
    expect(find('inventory-slot-0').classList.contains('is-selected')).toBe(false)
  })

  it('cancels a pending stack move when the same slot is clicked twice', () => {
    ui.update(snapshotFor('inventory'))
    find('inventory-slot-2').click()
    find('inventory-slot-2').click()
    expect(host.onMoveStack).not.toHaveBeenCalled()
    expect(find('inventory-slot-2').classList.contains('is-selected')).toBe(false)
  })

  it('reports pause menu actions', () => {
    ui.update(snapshotFor('pause'))
    find('pause-resume').click()
    find('pause-settings').click()
    find('pause-save').click()
    find('pause-quit').click()
    expect(host.onResume).toHaveBeenCalledTimes(1)
    expect(host.onOpenSettings).toHaveBeenCalledTimes(1)
    expect(host.onSave).toHaveBeenCalledTimes(1)
    expect(host.onQuit).toHaveBeenCalledTimes(1)
  })

  it('reports world selection and deletion', () => {
    ui.update(
      snapshotFor('worldSelect', {
        worlds: [{ worldId: 'w1', name: 'Alpha', seed: 1337, lastPlayedAt: 10 }],
      }),
    )
    expect(find('world-entry-w1').textContent).toContain('Alpha')
    find('world-play-w1').click()
    expect(host.onSelectWorld).toHaveBeenCalledWith('w1')
    find('world-delete-w1').click()
    expect(host.onDeleteWorld).toHaveBeenCalledWith('w1')
  })

  it('creates a world with the typed name and seed', () => {
    ui.update(snapshotFor('worldCreate'))
    const name = find('world-create-name') as HTMLInputElement
    const seed = find('world-create-seed') as HTMLInputElement
    name.value = 'My World'
    seed.value = '42'
    find('world-create-submit').click()
    expect(host.onCreateWorld).toHaveBeenCalledWith('My World', 42)
  })

  it('derives a deterministic seed when none is typed', () => {
    ui.update(snapshotFor('worldCreate'))
    const name = find('world-create-name') as HTMLInputElement
    name.value = 'Deterministic'
    find('world-create-submit').click()
    find('world-create-submit').click()
    const calls = host.onCreateWorld.mock.calls
    expect(calls.length).toBe(2)
    expect(calls[0][1]).toBe(calls[1][1])
    expect(Number.isInteger(calls[0][1])).toBe(true)
  })
})

describe('settings screen', () => {
  it('mirrors the snapshot into the controls', () => {
    ui.update(snapshotFor('settings'))
    const fov = find('setting-fov') as HTMLInputElement
    const renderDistance = find('setting-renderDistance') as HTMLInputElement
    expect(Number(fov.value)).toBe(PERF.fovDefault)
    expect(Number(renderDistance.value)).toBe(PERF.renderDistanceDefault)
    expect(renderDistance.min).toBe(String(PERF.renderDistanceMin))
    expect(renderDistance.max).toBe(String(PERF.renderDistanceMax))
  })

  it('reports slider and checkbox changes', () => {
    ui.update(snapshotFor('settings'))
    const fov = find('setting-fov') as HTMLInputElement
    fov.value = '90'
    fov.dispatchEvent(new Event('input', { bubbles: true }))
    expect(host.onChangeSetting).toHaveBeenCalledWith('fov', 90)

    const volume = find('setting-volume') as HTMLInputElement
    volume.value = '0.5'
    volume.dispatchEvent(new Event('input', { bubbles: true }))
    expect(host.onChangeSetting).toHaveBeenCalledWith('volume', 0.5)

    const showDebug = find('setting-showDebug') as HTMLInputElement
    showDebug.checked = true
    showDebug.dispatchEvent(new Event('change', { bubbles: true }))
    expect(host.onChangeSetting).toHaveBeenCalledWith('showDebug', true)
  })
})

describe('key bindings', () => {
  it('maps E, Escape, F3 and 1-9 to host callbacks', () => {
    ui.update(snapshotFor('playing'))

    press('e')
    expect(host.onToggleInventory).toHaveBeenCalledTimes(1)
    press('E')
    expect(host.onToggleInventory).toHaveBeenCalledTimes(2)

    press('Escape')
    expect(host.onCloseScreen).toHaveBeenCalledTimes(1)

    press('F3')
    expect(host.onChangeSetting).toHaveBeenCalledWith('showDebug', true)

    press('5')
    expect(host.onSelectHotbar).toHaveBeenLastCalledWith(4)
    press('1')
    expect(host.onSelectHotbar).toHaveBeenLastCalledWith(0)
    press('9')
    expect(host.onSelectHotbar).toHaveBeenLastCalledWith(8)
  })

  it('toggles the debug flag off again based on the current snapshot', () => {
    const base = createDefaultUiSnapshot()
    ui.update(snapshotFor('playing', { settings: { ...base.settings, showDebug: true } }))
    press('F3')
    expect(host.onChangeSetting).toHaveBeenCalledWith('showDebug', false)
  })

  it('ignores keys typed into text fields', () => {
    ui.update(snapshotFor('worldCreate'))
    const seed = find('world-create-seed')
    press('5', seed)
    press('e', seed)
    expect(host.onSelectHotbar).not.toHaveBeenCalled()
    expect(host.onToggleInventory).not.toHaveBeenCalled()
  })

  it('closes the local world-create navigation before telling the host', () => {
    ui.update(snapshotFor('worldSelect'))
    find('world-select-new').click()
    press('Escape')
    expect(find('world-select').hidden).toBe(false)
    expect(host.onCloseScreen).not.toHaveBeenCalled()
  })
})

describe('dispose', () => {
  it('removes the DOM and detaches the key listener', () => {
    ui.dispose()
    expect(root.children.length).toBe(0)
    press('e')
    press('5')
    expect(host.onToggleInventory).not.toHaveBeenCalled()
    expect(host.onSelectHotbar).not.toHaveBeenCalled()
    // afterEach disposes again; dispose must stay idempotent.
    expect(() => ui.dispose()).not.toThrow()
  })
})
