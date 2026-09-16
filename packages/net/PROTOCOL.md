# @voxelcraft/net wire format

Every constant here comes from `packages/core-types/src/v2/net.ts` and is frozen.
This file only records the payload layouts that the contract leaves to this
package. All fields are little endian. `str` is a u16 UTF-8 byte length followed
by the bytes; `blob` is a u32 byte length followed by the bytes.

Frame: `NET_HEADER_BYTES` (u16 magic `NET_MAGIC`, u8 version, u8 opcode,
u32 payload length) then the payload. One websocket binary message carries one
frame, but `FrameSplitter` also accepts split or coalesced chunks.

## client -> server

| opcode | name | payload |
| --- | --- | --- |
| 1 | Hello | u16 protocolVersion, u16 saveVersion, str playerName |
| 2 | Input | u32 tick, u16 bits, f32 yaw, f32 pitch, u8 hotbar |
| 3 | BlockEdit | u32 tick, i32 x, i32 y, i32 z, u16 block |
| 4 | Chat | str text |
| 5 | Pong | u32 nonce |

## server -> client

| opcode | name | payload |
| --- | --- | --- |
| 64 | Welcome | u32 playerId, u32 seed, u8 dimension, f32 spawnX, f32 spawnY, f32 spawnZ, u32 tick, u8 maxPlayers |
| 65 | Snapshot | u32 tick, u8 dimension, u32 timeOfDay, u16 count, count x entity record |
| 66 | ChunkData | u8 dimension, i32 cx, i32 cz, blob bytes |
| 67 | BlockChange | u8 dimension, i32 x, i32 y, i32 z, u16 block |
| 68 | EntityRemove | u16 count, count x u32 entity |
| 69 | ChatBroadcast | u32 playerId, str name, str text |
| 70 | Ping | u32 nonce, f64 serverTimeMs |
| 71 | Kick | str reason (a `NET_KICK_REASON` value) |
| 72 | TimeSync | u32 tick, u32 timeOfDay, f64 serverTimeMs |

Entity record (28 bytes): u32 entity, u16 kind, f32 x, f32 y, f32 z, f32 yaw,
f32 health, u16 flags.

## Chunk payload

`ChunkData.bytes` reuses the save-format chunk codec documented in
`packages/core-types/src/chunk.ts`: `CHUNK_MAGIC` (4 bytes), u16
`CHUNK_CODEC_VERSION`, u16 flags, u16 sectionMask, u16 reserved, then per set
section bit in ascending order a palette section:
`u16 paletteLen, paletteLen x u16 blockId, u8 bits, u8 pad, n x u32 data`.
`bits` is 0 when the section is a single block id (no data words), otherwise one
of 1, 2, 4, 8, 16 with `32 / bits` entries per word and no entry straddling a
word. The fluid layer follows with the same section mask as RLE pairs
(u8 value, u16 runLength), then block entities as
`u16 count, count x (u16 index, u16 jsonLen, jsonLen bytes of UTF-8 JSON)`.

## Handshake and liveness

1. Client connects to `NET.path` and sends Hello.
2. The server answers Welcome, or Kick with `protocol_mismatch` when
   `isCompatibleProtocol` is false, or `server_full` past `NET.maxPlayers`.
3. The server sends Ping every `NET.heartbeatMs`; a session with no traffic for
   `NET.timeoutMs` is kicked with `timeout`.
4. A payload that fails to decode is answered with Kick `bad_message`.
