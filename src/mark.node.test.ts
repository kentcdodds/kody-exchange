import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '../public')
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
const COLOR_TYPE_RGBA = 6

function readPngHeader(bytes: Uint8Array) {
	const header = String.fromCharCode(...bytes.slice(12, 16))
	if (
		bytes.byteLength < 25 ||
		!PNG_MAGIC.every((byte, index) => bytes[index] === byte) ||
		header !== 'IHDR'
	) {
		throw new Error('expected a PNG')
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	return {
		width: view.getUint32(16),
		height: view.getUint32(20),
		bitDepth: bytes[24],
		colorType: bytes[25],
	}
}

test('site mark and favicon are square RGBA so cream paper is not baked in', () => {
	const icon = readPngHeader(readFileSync(join(publicDir, 'icon.png')))
	expect(icon).toEqual({
		width: 256,
		height: 256,
		bitDepth: 8,
		colorType: COLOR_TYPE_RGBA,
	})

	const favicon = readPngHeader(readFileSync(join(publicDir, 'favicon.png')))
	expect(favicon).toEqual({
		width: 64,
		height: 64,
		bitDepth: 8,
		colorType: COLOR_TYPE_RGBA,
	})
})
