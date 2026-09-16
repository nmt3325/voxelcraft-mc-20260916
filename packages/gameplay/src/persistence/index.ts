/**
 * Chunk serialization and world persistence.
 *
 * - `chunkCodec` implements the frozen v1 chunk payload.
 * - `compression` picks `CompressionStream('deflate-raw')` or `node:zlib`.
 * - Stores: IndexedDB for the browser, memory and filesystem for Node.
 * - `writeQueue` batches chunk writes (32 chunks / 1.5 s).
 */

export {
	ByteReader,
	ByteWriter,
} from './bytes'
export {
	applySnapshotToChunk,
	bitsForPaletteLength,
	canDecodeChunk,
	chunkLocalIndex,
	CHUNK_CODEC,
	CHUNK_HEADER_BYTES,
	createChunkCodec,
	decodeChunk,
	decodeChunkAt,
	emptyChunkSnapshot,
	encodeChunk,
	entriesPerWord,
	SECTION_VOLUME,
	sectionMaskOf,
	snapshotFromChunk,
} from './chunkCodec'
export {
	compressionBackend,
	deflateRawBytes,
	inflateRawBytes,
	type CompressionBackend,
} from './compression'
export { createFsWorldStore, type FsWorldStoreOptions } from './fsStore'
export {
	createIndexedDbWorldStore,
	type IndexedDbWorldStoreOptions,
} from './indexedDbStore'
export { createMemoryWorldStore, type MemoryWorldStore } from './memoryStore'
export {
	copyBytes,
	DEFLATE_PAYLOADS,
	RAW_PAYLOADS,
	resolvePayloadCodec,
	type ChunkPayloadCodec,
	type WorldStoreOptions,
} from './support'
export {
	createChunkWriteQueue,
	DEFAULT_WRITE_TIMER,
	type ChunkWriteQueue,
	type ChunkWriteQueueOptions,
	type WriteTimer,
} from './writeQueue'
