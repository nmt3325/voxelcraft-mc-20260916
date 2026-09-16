import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAudio, joinUrl } from '../index'

const manifest = { sampleRate: 22050, files: { 'ui.click': 'ui-click.wav' } }

afterEach(() => {
  vi.restoreAllMocks()
})

describe('joinUrl', () => {
  it('joins relative files onto a base url', () => {
    expect(joinUrl('/assets/sounds', 'ui-click.wav')).toBe('/assets/sounds/ui-click.wav')
    expect(joinUrl('/assets/sounds/', 'ui-click.wav')).toBe('/assets/sounds/ui-click.wav')
  })

  it('leaves absolute references alone', () => {
    expect(joinUrl('/assets', '/generated/a.wav')).toBe('/generated/a.wav')
    expect(joinUrl('/assets', 'https://cdn.example/a.wav')).toBe('https://cdn.example/a.wav')
  })
})

describe('createAudio without WebAudio', () => {
  it('returns a silent handle instead of throwing', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const audio = createAudio({ manifest, baseUrl: '/assets/sounds', volume: 0.5 })
    expect(() => audio.play('ui.click')).not.toThrow()
    expect(() => audio.play('missing.sound', { volume: 0.2, pitch: 1.5 })).not.toThrow()
    expect(() => audio.setVolume(0.25)).not.toThrow()
    expect(() => audio.dispose()).not.toThrow()
    expect(() => audio.play('ui.click')).not.toThrow()

    expect(errorSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('stays silent when the manifest is missing', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const audio = createAudio({ manifest: null, baseUrl: '/assets/sounds' })
    expect(() => audio.play('block.break')).not.toThrow()
    audio.dispose()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('clamps the volume into 0..1', () => {
    const audio = createAudio({ manifest, baseUrl: '', volume: 42 })
    expect(() => audio.setVolume(-3)).not.toThrow()
    expect(() => audio.setVolume(Number.NaN)).not.toThrow()
    audio.dispose()
  })
})
