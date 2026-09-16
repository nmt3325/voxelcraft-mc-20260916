import type { SoundManifest } from '@voxelcraft/core-types'

export interface AudioPlayOptions {
  volume?: number
  pitch?: number
}

export interface AudioHandle {
  play(name: string, opts?: AudioPlayOptions): void
  setVolume(v: number): void
  dispose(): void
}

export interface CreateAudioOptions {
  /** Manifest produced by @voxelcraft/assets-gen. null disables playback. */
  manifest: SoundManifest | null
  baseUrl: string
  volume?: number
}

type AudioContextCtor = new () => AudioContext

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function clampPitch(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(0.25, Math.min(4, value))
}

function resolveAudioContextCtor(): AudioContextCtor | null {
  const scope = globalThis as unknown as {
    AudioContext?: AudioContextCtor
    webkitAudioContext?: AudioContextCtor
  }
  return scope.AudioContext ?? scope.webkitAudioContext ?? null
}

export function joinUrl(baseUrl: string, file: string): string {
  if (/^[a-z]+:\/\//i.test(file) || file.startsWith('data:') || file.startsWith('/')) return file
  if (baseUrl.length === 0) return file
  return baseUrl.endsWith('/') ? `${baseUrl}${file}` : `${baseUrl}/${file}`
}

/**
 * WebAudio playback for UI clicks, block break/place and footsteps.
 *
 * Every failure path is silent on purpose: no throwing and no console output,
 * because the E2E suite asserts zero console errors and the audio context can
 * legitimately be unavailable (Node, jsdom, or a headless page before the first
 * user gesture).
 */
export function createAudio(options: CreateAudioOptions): AudioHandle {
  let volume = clamp01(options.volume ?? 1)
  const Ctor = resolveAudioContextCtor()
  const canFetch = typeof fetch === 'function'
  const manifest = options.manifest

  if (Ctor === null || !canFetch || manifest === null) {
    return {
      play(): void {},
      setVolume(next: number): void {
        volume = clamp01(next)
      },
      dispose(): void {},
    }
  }

  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let disposed = false
  const buffers = new Map<string, Promise<AudioBuffer | null>>()

  const ensureContext = (): AudioContext | null => {
    if (disposed) return null
    if (ctx !== null) return ctx
    try {
      const created = new Ctor()
      const gain = created.createGain()
      gain.gain.value = volume
      gain.connect(created.destination)
      ctx = created
      master = gain
    } catch {
      ctx = null
      master = null
    }
    return ctx
  }

  const loadBuffer = (context: AudioContext, name: string): Promise<AudioBuffer | null> => {
    const cached = buffers.get(name)
    if (cached !== undefined) return cached
    const file = manifest.files[name]
    const pending: Promise<AudioBuffer | null> =
      typeof file === 'string' && file.length > 0
        ? fetch(joinUrl(options.baseUrl, file))
            .then((response) => (response.ok ? response.arrayBuffer() : null))
            .then((bytes) => (bytes === null ? null : context.decodeAudioData(bytes)))
            .catch(() => null)
        : Promise.resolve(null)
    buffers.set(name, pending)
    return pending
  }

  return {
    play(name: string, opts?: AudioPlayOptions): void {
      if (disposed) return
      const context = ensureContext()
      if (context === null) return
      if (context.state === 'suspended') {
        void context.resume().catch(() => undefined)
      }
      void loadBuffer(context, name)
        .then((buffer) => {
          if (disposed || buffer === null || ctx === null || master === null) return
          try {
            const source = ctx.createBufferSource()
            source.buffer = buffer
            source.playbackRate.value = clampPitch(opts?.pitch ?? 1)
            const gain = ctx.createGain()
            gain.gain.value = clamp01(opts?.volume ?? 1)
            source.connect(gain)
            gain.connect(master)
            source.start()
          } catch {
            // Stay silent: a dead audio graph must never break the frame loop.
          }
        })
        .catch(() => undefined)
    },
    setVolume(next: number): void {
      volume = clamp01(next)
      if (master !== null) master.gain.value = volume
    },
    dispose(): void {
      disposed = true
      buffers.clear()
      try {
        if (master !== null) master.disconnect()
      } catch {
        // ignore
      }
      if (ctx !== null) {
        void ctx.close().catch(() => undefined)
      }
      ctx = null
      master = null
    },
  }
}
