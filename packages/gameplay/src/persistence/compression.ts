/**
 * Chunk payload compression.
 *
 * Browsers (and Node 21.2+) get `CompressionStream('deflate-raw')`. Older Node
 * builds expose the constructor but reject the raw deflate format, so support is
 * probed once and anything without it falls back to `node:zlib`.
 *
 * The module specifiers are held in constants so bundlers keep the Node import
 * out of a browser graph: nothing here is imported statically.
 */

export type CompressionBackend = 'compression-stream' | 'node-zlib' | 'none'

type ZlibLike = {
	deflateRawSync: (input: Uint8Array) => Uint8Array
	inflateRawSync: (input: Uint8Array) => Uint8Array
}

type ByteStream = {
	readable: ReadableStream
	writable: WritableStream
}

const RAW_DEFLATE = 'deflate-raw'
const NODE_ZLIB = 'node:zlib'

let streamSupport: boolean | null = null
let zlibPromise: Promise<ZlibLike | null> | null = null

function supportsRawDeflateStreams(): boolean {
	if (streamSupport !== null) return streamSupport
	streamSupport = false
	const compression = (globalThis as { CompressionStream?: unknown }).CompressionStream
	const decompression = (globalThis as { DecompressionStream?: unknown }).DecompressionStream
	if (typeof compression === 'function' && typeof decompression === 'function') {
		try {
			new CompressionStream(RAW_DEFLATE)
			new DecompressionStream(RAW_DEFLATE)
			streamSupport = true
		} catch {
			// Node < 21.2: the constructor exists but 'deflate-raw' is unsupported.
			streamSupport = false
		}
	}
	return streamSupport
}

function isNodeRuntime(): boolean {
	const candidate = (globalThis as { process?: { versions?: { node?: string } } }).process
	return typeof candidate?.versions?.node === 'string'
}

async function loadZlib(): Promise<ZlibLike | null> {
	if (zlibPromise === null) {
		zlibPromise = isNodeRuntime()
			? import(NODE_ZLIB).then(
					(module) => module as unknown as ZlibLike,
					() => null,
				)
			: Promise.resolve(null)
	}
	return zlibPromise
}

async function runThroughStream(input: Uint8Array, stream: ByteStream): Promise<Uint8Array> {
	const writer = (stream.writable as WritableStream<Uint8Array>).getWriter()
	const pump = (async (): Promise<void> => {
		await writer.write(input)
		await writer.close()
	})()
	const reader = (stream.readable as ReadableStream<Uint8Array>).getReader()
	const chunks: Uint8Array[] = []
	let total = 0
	for (;;) {
		const next = await reader.read()
		if (next.done) break
		if (next.value !== undefined) {
			chunks.push(next.value)
			total += next.value.length
		}
	}
	await pump
	const out = new Uint8Array(total)
	let offset = 0
	for (const chunk of chunks) {
		out.set(chunk, offset)
		offset += chunk.length
	}
	return out
}

/** Which implementation `deflateRawBytes` will use on this runtime. */
export async function compressionBackend(): Promise<CompressionBackend> {
	if (supportsRawDeflateStreams()) return 'compression-stream'
	return (await loadZlib()) !== null ? 'node-zlib' : 'none'
}

export async function deflateRawBytes(input: Uint8Array): Promise<Uint8Array> {
	if (supportsRawDeflateStreams()) {
		return runThroughStream(input, new CompressionStream(RAW_DEFLATE))
	}
	const zlib = await loadZlib()
	if (zlib !== null) return new Uint8Array(zlib.deflateRawSync(input))
	throw new Error('no deflate-raw backend: CompressionStream and node:zlib are both unavailable')
}

export async function inflateRawBytes(input: Uint8Array): Promise<Uint8Array> {
	if (supportsRawDeflateStreams()) {
		return runThroughStream(input, new DecompressionStream(RAW_DEFLATE))
	}
	const zlib = await loadZlib()
	if (zlib !== null) return new Uint8Array(zlib.inflateRawSync(input))
	throw new Error('no deflate-raw backend: DecompressionStream and node:zlib are both unavailable')
}
