import { describe, expect, it } from 'vitest'
import { REQUIRED_SOUNDS, SOUND_SUBDIR, buildSounds } from '../sounds'
import { SOUND_SAMPLE_RATE } from '../wav'

const built = buildSounds()

function viewOf(wav: Uint8Array): DataView {
  return new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
}

function ascii(wav: Uint8Array, at: number, length: number): string {
  return String.fromCharCode(...wav.subarray(at, at + length))
}

function wavOf(name: string): Uint8Array {
  const wav = built.wavs[name]
  if (!wav) throw new Error(`missing wav for ${name}`)
  return wav
}

describe('sound manifest', () => {
  it('lists every required sound with a relative path', () => {
    expect(Object.keys(built.manifest.files).sort()).toEqual([...REQUIRED_SOUNDS].sort())
    for (const name of REQUIRED_SOUNDS) {
      expect(built.manifest.files[name]).toBe(`${SOUND_SUBDIR}/${name}.wav`)
    }
  })

  it('declares the encoder sample rate', () => {
    expect(built.manifest.sampleRate).toBe(SOUND_SAMPLE_RATE)
    expect([22050, 44100]).toContain(built.manifest.sampleRate)
  })
})

describe('wav files', () => {
  it('are RIFF/PCM mono 16 bit streams with consistent chunk sizes', () => {
    for (const name of REQUIRED_SOUNDS) {
      const wav = wavOf(name)
      const view = viewOf(wav)
      expect(ascii(wav, 0, 4), name).toBe('RIFF')
      expect(ascii(wav, 8, 4), name).toBe('WAVE')
      expect(ascii(wav, 12, 4), name).toBe('fmt ')
      expect(ascii(wav, 36, 4), name).toBe('data')
      expect(view.getUint32(4, true), name).toBe(wav.length - 8)
      expect(view.getUint32(16, true), name).toBe(16)
      expect(view.getUint16(20, true), name).toBe(1)
      expect(view.getUint16(22, true), name).toBe(1)
      expect(view.getUint32(24, true), name).toBe(built.manifest.sampleRate)
      expect(view.getUint16(34, true), name).toBe(16)
      const dataBytes = view.getUint32(40, true)
      expect(dataBytes, name).toBe(wav.length - 44)
      expect(dataBytes % 2, name).toBe(0)
      expect(dataBytes, name).toBeGreaterThan(0)
    }
  })

  it('are audible rather than silent', () => {
    for (const name of REQUIRED_SOUNDS) {
      const wav = wavOf(name)
      const view = viewOf(wav)
      let peak = 0
      for (let at = 44; at + 1 < wav.length; at += 2) {
        const sample = Math.abs(view.getInt16(at, true))
        if (sample > peak) peak = sample
      }
      expect(peak, name).toBeGreaterThan(1000)
    }
  })

  it('renders byte identical audio on a second build', () => {
    const again = buildSounds()
    expect(again.manifest).toEqual(built.manifest)
    for (const name of REQUIRED_SOUNDS) {
      const first = built.wavs[name] ?? new Uint8Array()
      const second = again.wavs[name] ?? new Uint8Array()
      expect(Buffer.from(second).equals(Buffer.from(first)), name).toBe(true)
    }
  })
})
