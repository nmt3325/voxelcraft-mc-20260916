/**
 * Portal frames and dimension linking. Owned by task v2-world-portal (an L2 of
 * task v2-world). L1-F wires `createPortalLinker` into the dimension layer;
 * nothing in this directory reaches outside `src/portal/**`.
 */
export { LANDING_SEARCH_RADIUS, createPortalLinker } from './link'
export {
	FRAME_BLOCK,
	PORTAL_AXES,
	PORTAL_BLOCK,
	frameAlong,
	frameSide,
	isLavaBlock,
	isPortalInterior,
	makeFrame,
	validateFrameAt,
	writeFrame,
} from './frame'
export type { PortalAxis } from './frame'
