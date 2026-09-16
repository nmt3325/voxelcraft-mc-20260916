import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// Procedurally generated textures and sounds are emitted by
// packages/assets-gen (atlas.png, atlas.json, sounds.json, sounds/*.wav) and
// served as static files. They are build output, not committed assets, so the
// build records whether they exist: the client must not request a missing file,
// because the browser reports a 404 as a console error and the E2E suite
// asserts that the page logs none.
const generatedDir = fileURLToPath(new URL('../../packages/assets-gen/generated', import.meta.url))
const hasGeneratedAssets = existsSync(`${generatedDir}/atlas.json`)

export default defineConfig({
	base: './',
	// The game speaks the protocol but is not a dependency of @voxelcraft/net,
	// so the browser safe half is bundled straight from source.
	resolve: {
		alias: {
			'@voxelcraft/net': fileURLToPath(new URL('../../packages/net/src/index.ts', import.meta.url)),
		},
	},
	publicDir: hasGeneratedAssets ? generatedDir : false,
	define: { __VC_HAS_ASSETS__: JSON.stringify(hasGeneratedAssets) },
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
