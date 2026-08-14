import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm'
import yogaWasm from 'satori/yoga.wasm'

export type OgAssetsFetcher = { fetch: (request: Request) => Promise<Response> }

const FONT_URLS = {
	fraunces700: 'https://assets.local/og/fraunces-latin-700-normal.woff',
	sourceSerif400:
		'https://assets.local/og/source-serif-4-latin-400-normal.woff',
} as const

type OgFontCache = {
	fraunces700: ArrayBuffer
	sourceSerif400: ArrayBuffer
}

let cache: OgFontCache | null = null
let loadPromise: Promise<void> | null = null

export const ogYogaWasm = yogaWasm
export const ogResvgWasm = resvgWasm

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer
}

async function fetchAssetBytes(
	assets: OgAssetsFetcher,
	url: string,
): Promise<Uint8Array> {
	const response = await assets.fetch(new Request(url))
	if (!response.ok) {
		throw new Error(`OG asset fetch failed: ${url} (${response.status})`)
	}
	return new Uint8Array(await response.arrayBuffer())
}

function requireCache(): OgFontCache {
	if (!cache) {
		throw new Error('OG fonts are not loaded')
	}
	return cache
}

/** Test hook: clears the per-isolate OG font cache. */
export function resetOgFontCache() {
	cache = null
	loadPromise = null
}

export async function ensureOgFontsReady(input?: {
	assets?: OgAssetsFetcher
}): Promise<void> {
	if (cache) return
	if (!input?.assets) {
		throw new Error('OG fonts require an ASSETS binding')
	}
	if (!loadPromise) {
		const assets = input.assets
		loadPromise = Promise.all([
			fetchAssetBytes(assets, FONT_URLS.fraunces700),
			fetchAssetBytes(assets, FONT_URLS.sourceSerif400),
		])
			.then(([fraunces700, sourceSerif400]) => {
				cache = {
					fraunces700: toArrayBuffer(fraunces700),
					sourceSerif400: toArrayBuffer(sourceSerif400),
				}
			})
			.catch((error) => {
				loadPromise = null
				throw error
			})
	}
	await loadPromise
}

export function getFraunces700FontData(): ArrayBuffer {
	return requireCache().fraunces700
}

export function getSourceSerif400FontData(): ArrayBuffer {
	return requireCache().sourceSerif400
}

/** Worker builds do not ship a filesystem fallback for the mark. */
export function readBundledIconBytes(): Uint8Array | null {
	return null
}
