/**
 * Deterministic PNG encoder: RGBA8, non-interlaced, row filter 0 (None).
 * Fixed zlib settings, so the same pixels always produce the same bytes.
 */
import { constants, deflateSync } from 'node:zlib'
import { concatBytes, crc32, deflateStore, u32be } from './zlib-lite'

export const PNG_SIGNATURE: Uint8Array = Uint8Array.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])

export interface PngImage {
	width: number
	height: number
	/** RGBA8, row-major, length must be width * height * 4. */
	data: Uint8Array
}

export type PngCompression = 'zlib' | 'store'

function chunk(type: string, body: Uint8Array): Uint8Array {
	const head = new Uint8Array(4)
	for (let i = 0; i < 4; i++) head[i] = type.charCodeAt(i) & 0xff
	const payload = concatBytes([head, body])
	return concatBytes([u32be(body.length), payload, u32be(crc32(payload))])
}

function filterRows(image: PngImage): Uint8Array {
	const stride = image.width * 4
	const out = new Uint8Array((stride + 1) * image.height)
	for (let y = 0; y < image.height; y++) {
		const row = y * (stride + 1)
		out[row] = 0
		out.set(image.data.subarray(y * stride, y * stride + stride), row + 1)
	}
	return out
}

export function encodePng(image: PngImage, compression: PngCompression = 'zlib'): Uint8Array {
	const { width, height, data } = image
	if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
		throw new Error(`encodePng: bad size ${width}x${height}`)
	}
	if (data.length !== width * height * 4) {
		throw new Error(`encodePng: expected ${width * height * 4} RGBA bytes, got ${data.length}`)
	}
	const raw = filterRows(image)
	const idat =
		compression === 'store'
			? deflateStore(raw)
			: Uint8Array.from(
					deflateSync(raw, {
						level: 9,
						memLevel: 9,
						windowBits: 15,
						strategy: constants.Z_DEFAULT_STRATEGY,
					}),
				)
	const ihdr = new Uint8Array(13)
	ihdr.set(u32be(width), 0)
	ihdr.set(u32be(height), 4)
	ihdr[8] = 8 // bit depth
	ihdr[9] = 6 // colour type: truecolour with alpha
	return concatBytes([
		PNG_SIGNATURE,
		chunk('IHDR', ihdr),
		chunk('IDAT', idat),
		chunk('IEND', new Uint8Array(0)),
	])
}
