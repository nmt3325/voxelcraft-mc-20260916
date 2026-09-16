/**
 * Minimal Worker scope typing for the mesher worker.
 *
 * The workspace compiles with `lib: ["ES2022", "DOM", "DOM.Iterable"]`, so the
 * real `WorkerGlobalScope` types are not available and `self` is typed as the
 * DOM `Window`. Declaring a tiny structural scope here keeps the worker file
 * honest without pulling in `lib.webworker.d.ts`, which would collide with the
 * DOM definitions used by the renderer.
 *
 * This file intentionally has no imports/exports so the declarations stay global.
 */

declare interface VcWorkerMessageEvent<T = unknown> {
	readonly data: T
}

declare interface VcWorkerScope {
	onmessage: ((event: VcWorkerMessageEvent) => void) | null
	onmessageerror: ((event: VcWorkerMessageEvent) => void) | null
	postMessage(message: unknown, transfer?: ArrayBuffer[]): void
	close(): void
}
