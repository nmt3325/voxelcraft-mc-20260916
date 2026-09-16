/* Wires workspace dependencies. L0 owns dependency declarations; children must
   never add or bump a dependency (report contract_changes_needed instead). */
const fs = require('node:fs')
const path = require('node:path')

const graph = {
	'packages/world': ['core-types'],
	'packages/sim': ['core-types', 'world'],
	'packages/gameplay': ['core-types', 'world', 'sim'],
	'packages/assets-gen': ['core-types'],
	'packages/client': ['core-types', 'world', 'sim', 'gameplay', 'assets-gen'],
	'apps/game': ['core-types', 'world', 'sim', 'gameplay', 'client', 'assets-gen', 'net'],
	'packages/net': ['core-types'],
	'apps/server': ['core-types', 'net'],
	'tests/e2e': ['core-types'],
	'tests/bench': ['core-types', 'world', 'sim', 'gameplay', 'client'],
}

let changed = 0
for (const [dir, list] of Object.entries(graph)) {
	const file = path.join(dir, 'package.json')
	const json = JSON.parse(fs.readFileSync(file, 'utf8'))
	if (!json.dependencies) json.dependencies = {}
	for (const dep of list) {
		const key = '@voxelcraft/' + dep
		if (json.dependencies[key] !== 'workspace:*') {
			json.dependencies[key] = 'workspace:*'
			changed++
		}
	}
	fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n')
}
console.log('WIRE_DEPS changed=' + changed)
