/** Procedural one-shot sound effects: filtered hash noise plus a decaying tone. */
import type { SoundManifest } from '@voxelcraft/core-types'
import {
  TWO_PI,
  applyEdgeFades,
  decayFactor,
  highpassInPlace,
  lowpassInPlace,
  makeNoise,
  normalizePeak,
  sinApprox,
} from './dsp'
import { assetSeed } from './seed'
import { SOUND_SAMPLE_RATE, encodeWav } from './wav'

/** Sounds live in this subdirectory of the generated output. */
export const SOUND_SUBDIR = 'sounds'

export const REQUIRED_SOUNDS: readonly string[] = [
  'dig_stone',
  'dig_dirt',
  'dig_grass',
  'dig_sand',
  'dig_wood',
  'dig_glass',
  'dig_wool',
  'dig_metal',
  'dig_snow',
  'dig_plant',
  'place_generic',
  'step_stone',
  'step_grass',
  'step_sand',
  'step_wood',
  'ui_click',
  'hurt',
  'splash',
  'pop',
]

/**
 * seconds, lowpass alpha, highpass alpha, decay tau (ms), attack (ms),
 * tone frequency (Hz, 0 = noise only), tone mix, tone bend, target peak.
 */
export type SoundSpec = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
]

export const SOUND_SPECS: Readonly<Record<string, SoundSpec>> = {
  dig_stone: [0.17, 0.5, 0.1, 38, 1, 140, 0.12, -0.35, 0.82],
  dig_dirt: [0.16, 0.28, 0.04, 34, 1, 90, 0.1, -0.3, 0.8],
  dig_grass: [0.18, 0.7, 0.25, 30, 1, 0, 0, 0, 0.72],
  dig_sand: [0.2, 0.85, 0.35, 42, 1, 0, 0, 0, 0.7],
  dig_wood: [0.16, 0.45, 0.12, 30, 1, 210, 0.3, -0.4, 0.84],
  dig_glass: [0.22, 0.95, 0.5, 26, 1, 1400, 0.35, -0.2, 0.86],
  dig_wool: [0.14, 0.18, 0.02, 30, 2, 0, 0, 0, 0.6],
  dig_metal: [0.24, 0.8, 0.2, 60, 1, 620, 0.45, -0.15, 0.88],
  dig_snow: [0.15, 0.6, 0.3, 24, 1, 0, 0, 0, 0.66],
  dig_plant: [0.13, 0.9, 0.45, 20, 1, 0, 0, 0, 0.64],
  place_generic: [0.15, 0.4, 0.1, 30, 1, 160, 0.2, -0.35, 0.8],
  step_stone: [0.1, 0.5, 0.15, 18, 1, 120, 0.12, -0.3, 0.6],
  step_grass: [0.1, 0.75, 0.3, 16, 1, 0, 0, 0, 0.5],
  step_sand: [0.12, 0.88, 0.4, 20, 1, 0, 0, 0, 0.48],
  step_wood: [0.1, 0.45, 0.12, 18, 1, 190, 0.25, -0.35, 0.58],
  ui_click: [0.06, 0.7, 0.2, 10, 1, 880, 0.6, -0.1, 0.7],
  hurt: [0.3, 0.35, 0.05, 90, 2, 220, 0.5, -0.45, 0.9],
  splash: [0.45, 0.6, 0.18, 150, 4, 0, 0, 0, 0.78],
  pop: [0.09, 0.55, 0.1, 14, 1, 520, 0.7, 0.9, 0.72],
}

export function renderSound(name: string, spec: SoundSpec): Float32Array {
  const [seconds, lowpass, highpass, tauMs, attackMs, tone, toneMix, toneBend, peak] = spec
  const rate = SOUND_SAMPLE_RATE
  const n = Math.max(1, Math.round(seconds * rate))
  const buf = new Float32Array(n)
  const noise = makeNoise(assetSeed(name), 0x51)
  for (let i = 0; i < n; i++) buf[i] = noise()
  if (lowpass < 1) lowpassInPlace(buf, lowpass)
  if (highpass > 0) highpassInPlace(buf, highpass)
  const decay = decayFactor((tauMs / 1000) * rate)
  const attack = Math.max(1, Math.round((attackMs / 1000) * rate))
  let env = 1
  let phase = 0
  for (let i = 0; i < n; i++) {
    const rise = i < attack ? (i + 1) / attack : 1
    phase += (TWO_PI * tone * (1 + toneBend * (i / n))) / rate
    const osc = tone > 0 ? sinApprox(phase) : 0
    buf[i] = (buf[i] * (1 - toneMix) + osc * toneMix) * env * rise
    env *= decay
  }
  applyEdgeFades(buf, 8, Math.min(64, Math.floor(n / 8)))
  normalizePeak(buf, peak)
  return buf
}

export type BuiltSounds = {
  readonly manifest: SoundManifest
  readonly wavs: Readonly<Record<string, Uint8Array>>
}

export function buildSounds(): BuiltSounds {
  const files: Record<string, string> = {}
  const wavs: Record<string, Uint8Array> = {}
  for (const name of REQUIRED_SOUNDS) {
    const spec = SOUND_SPECS[name]
    if (!spec) throw new Error(`no sound spec registered for "${name}"`)
    wavs[name] = encodeWav(renderSound(name, spec), SOUND_SAMPLE_RATE)
    files[name] = `${SOUND_SUBDIR}/${name}.wav`
  }
  return { manifest: { sampleRate: SOUND_SAMPLE_RATE, files }, wavs }
}
