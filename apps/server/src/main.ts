/**
 * Process entry point: `pnpm --filter @voxelcraft/server start`.
 *
 * PORT overrides the frozen default port, HOST the bind address and SEED the
 * world seed. Kept tiny on purpose - everything testable lives in start.ts.
 */
import process from 'node:process'
import { defaultPort, startGameServer } from './start'

const host = process.env.HOST ?? '0.0.0.0'
const seed = Number.parseInt(process.env.SEED ?? '', 10)

const running = await startGameServer({
	host,
	port: defaultPort(process.env),
	seed: Number.isInteger(seed) ? seed : undefined,
})

console.log(
	`voxelcraft server listening on ws://${host}:${running.port}${running.server.path} ` +
		`(seed ${running.server.world.seed}, max ${running.server.sessions.maxPlayers} players)`,
)

let closing = false

async function shutdown(signal: string): Promise<void> {
	if (closing) return
	closing = true
	console.log(`${signal}: kicking players and closing the port`)
	await running.close()
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => {
		void shutdown(signal)
	})
}
