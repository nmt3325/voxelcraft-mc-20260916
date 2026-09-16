/**
 * Injected by `vite.config.ts` via `define`.
 *
 * True when `packages/assets-gen/generated` exists at build time. The game only
 * fetches atlas.png / atlas.json / sounds.json when this is true, because a 404
 * would be reported as a browser console error and the E2E suite asserts that
 * the page logs none.
 */
declare const __VC_HAS_ASSETS__: boolean
