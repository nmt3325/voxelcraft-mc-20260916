import { PERF } from '@voxelcraft/core-types'
import { button, el, setHidden, setInputValue, setText } from './dom'
import type { UiPanel, UiSettings, UiSnapshot } from './types'

export interface SettingsHost {
  onChangeSetting?(key: keyof UiSettings, value: number | boolean): void
  onCloseScreen?(): void
  onPlaySound?(name: string): void
}

type NumericSettingKey = 'renderDistance' | 'fov' | 'sensitivity' | 'volume'

interface RangeField {
  row: HTMLElement
  apply(value: number): void
}

export function createSettingsScreen(doc: Document, host: SettingsHost): UiPanel {
  const makeRange = (
    key: NumericSettingKey,
    label: string,
    min: number,
    max: number,
    step: number,
    format: (value: number) => string,
  ): RangeField => {
    const input = el(doc, 'input', {
      type: 'range',
      min: String(min),
      max: String(max),
      step: String(step),
      'data-testid': `setting-${key}`,
    })
    const valueNode = el(doc, 'span', {
      class: 'vc-field-value',
      'data-testid': `setting-${key}-value`,
    })
    input.addEventListener('input', () => {
      const parsed = Number(input.value)
      if (!Number.isFinite(parsed)) return
      setText(valueNode, format(parsed))
      host.onChangeSetting?.(key, parsed)
    })
    const row = el(doc, 'label', { class: 'vc-field' }, [
      el(doc, 'span', {}, [label]),
      input,
      valueNode,
    ])
    return {
      row,
      apply(value: number): void {
        setInputValue(input, String(value))
        setText(valueNode, format(value))
      },
    }
  }

  const renderDistance = makeRange(
    'renderDistance',
    'Render distance',
    PERF.renderDistanceMin,
    PERF.renderDistanceMax,
    1,
    (v) => `${Math.round(v)} chunks`,
  )
  const fov = makeRange('fov', 'Field of view', 30, 110, 1, (v) => `${Math.round(v)} deg`)
  const sensitivity = makeRange('sensitivity', 'Mouse sensitivity', 0.0005, 0.01, 0.0001, (v) =>
    v.toFixed(4),
  )
  const volume = makeRange('volume', 'Volume', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`)

  const debugInput = el(doc, 'input', {
    type: 'checkbox',
    'data-testid': 'setting-showDebug',
  })
  debugInput.addEventListener('change', () => {
    host.onChangeSetting?.('showDebug', debugInput.checked)
  })
  const debugRow = el(doc, 'label', { class: 'vc-field' }, [
    el(doc, 'span', {}, ['Debug overlay (F3)']),
    debugInput,
  ])

  const closeButton = button(doc, 'settings-close', 'Done', () => {
    host.onPlaySound?.('ui.click')
    host.onCloseScreen?.()
  })

  const element = el(
    doc,
    'div',
    { class: 'vc-screen vc-settings', 'data-testid': 'settings-screen' },
    [
      el(doc, 'h2', {}, ['Settings']),
      el(doc, 'div', { class: 'vc-form' }, [
        renderDistance.row,
        fov.row,
        sensitivity.row,
        volume.row,
        debugRow,
      ]),
      closeButton,
    ],
  )

  return {
    element,
    update(snapshot: UiSnapshot): void {
      setHidden(element, snapshot.screen !== 'settings')
      const s = snapshot.settings
      renderDistance.apply(s.renderDistance)
      fov.apply(s.fov)
      sensitivity.apply(s.sensitivity)
      volume.apply(s.volume)
      if (debugInput.checked !== s.showDebug) debugInput.checked = s.showDebug
    },
  }
}
