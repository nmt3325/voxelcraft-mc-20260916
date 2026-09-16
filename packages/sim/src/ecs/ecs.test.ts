import { describe, expect, it } from 'vitest'
import { Transform, Velocity } from './components'
import { createEcsWorld, defineComponent } from './ecs'

describe('sparse-set ECS', () => {
	it('returns query results in ascending entity order', () => {
		const world = createEcsWorld()
		const ids = [world.create(), world.create(), world.create(), world.create()]
		// Add in a scrambled order: the query must still come back ascending.
		for (const index of [2, 0, 3, 1]) {
			const entity = ids[index]
			world.add(entity, Transform, Transform.create())
		}
		expect([...world.query([Transform])]).toEqual([...ids].sort((a, b) => a - b))
	})

	it('intersects components and picks the smallest set first', () => {
		const world = createEcsWorld()
		const a = world.create()
		const b = world.create()
		const c = world.create()
		world.add(a, Transform, Transform.create())
		world.add(b, Transform, Transform.create())
		world.add(c, Transform, Transform.create())
		world.add(b, Velocity, Velocity.create())
		expect([...world.query([Transform, Velocity])]).toEqual([b])
		expect([...world.query([Velocity, Transform])]).toEqual([b])
	})

	it('applies structural changes immediately outside a query', () => {
		const world = createEcsWorld()
		const entity = world.create()
		world.add(entity, Transform, Transform.create())
		expect(world.has(entity, Transform)).toBe(true)
		expect(world.entityCount).toBe(1)
		world.remove(entity, Transform)
		expect(world.has(entity, Transform)).toBe(false)
		world.destroy(entity)
		expect(world.alive(entity)).toBe(false)
		expect(world.entityCount).toBe(0)
	})

	it('buffers structural changes made while iterating a query', () => {
		const world = createEcsWorld()
		const a = world.create()
		const b = world.create()
		world.add(a, Transform, Transform.create())
		world.add(b, Transform, Transform.create())

		const snapshot = world.query([Transform])
		for (const entity of snapshot) {
			if (entity === b) world.destroy(entity)
			else world.add(entity, Velocity, Velocity.create())
		}
		// Nothing has been applied yet, so the iteration stayed consistent.
		expect([...snapshot]).toEqual([a, b])
		expect(world.alive(b)).toBe(true)
		expect(world.has(a, Velocity)).toBe(false)

		world.flush()
		expect(world.alive(b)).toBe(false)
		expect(world.has(a, Velocity)).toBe(true)
		expect([...world.query([Transform])]).toEqual([a])
	})

	it('gives every component type a distinct id and a fresh value', () => {
		const first = defineComponent<{ value: number }>('testFirst', () => ({ value: 1 }))
		const second = defineComponent<{ value: number }>('testSecond', () => ({ value: 2 }))
		expect(first.id).not.toBe(second.id)
		expect(first.name).toBe('testFirst')
		const world = createEcsWorld()
		const a = world.create()
		const b = world.create()
		world.add(a, first, first.create())
		world.add(b, first, first.create())
		const valueA = world.get(a, first)
		const valueB = world.get(b, first)
		expect(valueA).not.toBe(valueB)
		if (valueA) valueA.value = 99
		expect(world.get(b, first)?.value).toBe(1)
	})

	it('reuses entity slots deterministically after a destroy', () => {
		const world = createEcsWorld()
		const a = world.create()
		const b = world.create()
		world.add(a, Transform, Transform.create())
		world.destroy(a)
		world.flush()
		// The freed slot is handed out again, and it comes back clean.
		const c = world.create()
		expect(c).toBe(a)
		expect(world.has(c, Transform)).toBe(false)
		expect(world.alive(b)).toBe(true)
		expect(world.alive(c)).toBe(true)
		expect(world.entityCount).toBe(2)
	})
})
