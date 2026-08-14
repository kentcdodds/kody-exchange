import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const publicDir = join(dirname(fileURLToPath(import.meta.url)), '../public')

export type OgAssetsFetcher = { fetch: (request: Request) => Promise<Response> }

type OgFontCache = {
	fraunces700: ArrayBuffer
	sourceSerif400: ArrayBuffer
}

let cache: OgFontCache | null = null

// Workers types mark `WebAssembly.Module` abstract and omit `compile`.
const compileWasm = (
	globalThis.WebAssembly as unknown as {
		compile: (bytes: BufferSource) => Promise<WebAssembly.Module>
	}
).compile

export const ogYogaWasm = await compileWasm(
	readFileSync(require.resolve('satori/yoga.wasm')),
)
export const ogResvgWasm = await compileWasm(
	readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')),
)

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer
}

function ensureCache(): OgFontCache {
	if (cache) return cache
	cache = {
		fraunces700: toArrayBuffer(
			readFileSync(join(publicDir, 'og/fraunces-latin-700-normal.woff')),
		),
		sourceSerif400: toArrayBuffer(
			readFileSync(join(publicDir, 'og/source-serif-4-latin-400-normal.woff')),
		),
	}
	return cache
}

/** Test hook: clears the per-process OG font cache. */
export function resetOgFontCache() {
	cache = null
}

export async function ensureOgFontsReady(_input?: {
	assets?: OgAssetsFetcher
}): Promise<void> {
	ensureCache()
}

export function getFraunces700FontData(): ArrayBuffer {
	return ensureCache().fraunces700
}

export function getSourceSerif400FontData(): ArrayBuffer {
	return ensureCache().sourceSerif400
}

export function readBundledIconBytes(): Uint8Array | null {
	return readFileSync(join(publicDir, 'icon.png'))
}
