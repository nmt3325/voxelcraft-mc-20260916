import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  // Procedurally generated textures and sounds are emitted by
  // packages/assets-gen and served as static files (atlas.png, atlas.json,
  // sounds.json, sounds/*.wav). They are build output, not committed assets.
  publicDir: fileURLToPath(new URL('../../packages/assets-gen/generated', import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL('../../dist', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 2048,
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  worker: { format: 'es' },
})
