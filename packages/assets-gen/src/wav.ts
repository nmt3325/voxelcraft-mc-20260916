/** RIFF/WAVE encoder: PCM, 16 bit, mono, fixed sample rate. */

export const SOUND_SAMPLE_RATE = 22050

function quantize(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i]
    const clamped = v > 1 ? 1 : v < -1 ? -1 : v
    out[i] = Math.round(clamped * 32767)
  }
  return out
}

function ascii(out: Uint8Array, at: number, text: string): void {
  for (let i = 0; i < text.length; i++) out[at + i] = text.charCodeAt(i) & 0xff
}

export function encodeWav(
  samples: Float32Array | Int16Array,
  sampleRate: number = SOUND_SAMPLE_RATE,
): Uint8Array {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new Error(`encodeWav: bad sample rate ${sampleRate}`)
  }
  const pcm = samples instanceof Int16Array ? samples : quantize(samples)
  const dataBytes = pcm.length * 2
  const out = new Uint8Array(44 + dataBytes)
  const view = new DataView(out.buffer)
  ascii(out, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(out, 8, 'WAVE')
  ascii(out, 12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  ascii(out, 36, 'data')
  view.setUint32(40, dataBytes, true)
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i], true)
  return out
}
