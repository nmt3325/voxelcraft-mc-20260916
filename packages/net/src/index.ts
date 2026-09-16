/**
 * @voxelcraft/net - transport and protocol library for the authoritative
 * multiplayer server.
 *
 * Layering, bottom up:
 *   bytes       little-endian reader/writer primitives
 *   frame       the frozen 8 byte header plus streaming reassembly
 *   codec       one encoder/decoder pair per opcode (see PROTOCOL.md)
 *   protocol    version compatibility and opcode direction guards
 *   heartbeat   ping/pong bookkeeping from the NET timing constants
 *   sessions    server side registry of connected players
 *   connection  client side state machine with reconnect backoff
 *
 * Nothing here touches node APIs, so the same module works in the browser.
 * The RFC 6455 websocket transport lives behind the `@voxelcraft/net/ws`
 * entry point because it needs node:http and node:crypto.
 */
export const PACKAGE_NAME = '@voxelcraft/net'

export * from './bytes'
export * from './frame'
