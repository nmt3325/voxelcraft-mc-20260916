import type { MesherMessage } from '@voxelcraft/core-types'
import { collectTransferables, createMesherWorkerState, handleMesherMessage } from './protocol'

/**
 * Mesher worker entry.
 *
 * The scope is typed through `worker-env.d.ts` instead of `lib.webworker`, which
 * would clash with the DOM types the renderer needs. Mesh buffers are
 * transferred (not copied) back to the host.
 */

const scope = self as unknown as VcWorkerScope
const state = createMesherWorkerState()

scope.onmessage = (event: VcWorkerMessageEvent): void => {
	const response = handleMesherMessage(state, event.data as MesherMessage)
	if (response === null) return
	if (response.type === 'mesh') {
		scope.postMessage(response, collectTransferables(response.result))
		return
	}
	scope.postMessage(response)
}

export {}
