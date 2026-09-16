/**
 * The entity record is the hot path: a Snapshot carries one per visible entity
 * at snapshotHz, so it is fixed width and lives here rather than being
 * re-derived inside the Snapshot codec.
 */
import type { NetEntitySnapshot } from '@voxelcraft/core-types'
import type { ByteReader, ByteWriter } from '../bytes'

/** u32 entity, u16 kind, f32 x, f32 y, f32 z, f32 yaw, f32 health, u16 flags. */
export const ENTITY_RECORD_BYTES = 28

export function writeEntity(w: ByteWriter, e: NetEntitySnapshot): void {
	w.u32(e.entity)
	w.u16(e.kind)
	w.f32(e.x)
	w.f32(e.y)
	w.f32(e.z)
	w.f32(e.yaw)
	w.f32(e.health)
	w.u16(e.flags)
}

export function readEntity(r: ByteReader): NetEntitySnapshot {
	// Read into locals first: the field order is the wire order, and an object
	// literal would hide that behind property-evaluation order.
	const entity = r.u32()
	const kind = r.u16()
	const x = r.f32()
	const y = r.f32()
	const z = r.f32()
	const yaw = r.f32()
	const health = r.f32()
	const flags = r.u16()
	return { entity, kind, x, y, z, yaw, health, flags }
}
