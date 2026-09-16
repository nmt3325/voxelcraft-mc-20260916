import { el, fmt, setHidden, setText } from './dom'
import type { UiPanel, UiSnapshot } from './types'

const DEBUG_SCREENS = new Set(['playing', 'inventory', 'pause'])

/** F3-style overlay: fps, position, biome, chunk and draw statistics. */
export function createDebugOverlay(doc: Document): UiPanel {
  const rows = new Map<string, HTMLElement>()
  const row = (id: string): HTMLElement => {
    const node = el(doc, 'div', { class: 'vc-debug-row', 'data-testid': `debug-${id}` })
    rows.set(id, node)
    return node
  }

  const element = el(doc, 'div', { class: 'vc-debug', 'data-testid': 'debug-overlay' }, [
    row('fps'),
    row('pos'),
    row('facing'),
    row('biome'),
    row('chunks'),
    row('draws'),
    row('geometry'),
    row('render-distance'),
  ])

  const write = (id: string, text: string): void => {
    const node = rows.get(id)
    if (node) setText(node, text)
  }

  return {
    element,
    update(snapshot: UiSnapshot): void {
      const visible = snapshot.settings.showDebug && DEBUG_SCREENS.has(snapshot.screen)
      setHidden(element, !visible)
      if (!visible) return
      const d = snapshot.debug
      write('fps', `FPS ${Math.round(d.fps)}`)
      write('pos', `XYZ ${fmt(d.x, 2)} / ${fmt(d.y, 2)} / ${fmt(d.z, 2)}`)
      write('facing', `Facing yaw ${fmt(d.yaw, 1)} pitch ${fmt(d.pitch, 1)}`)
      write('biome', `Biome ${d.biome}`)
      write('chunks', `Chunks ${d.chunks}`)
      write('draws', `Draw calls ${d.drawCalls}`)
      write('geometry', `Quads ${d.quads} Tris ${d.triangles}`)
      write('render-distance', `Render distance ${d.renderDistance}`)
    },
  }
}
