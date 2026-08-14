import { initWasm, Resvg } from '@resvg/resvg-wasm'
import satori, { init as initSatori } from 'satori/standalone'
import { type AppEnv } from '#src/env.ts'
import {
	ensureOgFontsReady,
	getFraunces700FontData,
	getSourceSerif400FontData,
	ogResvgWasm,
	ogYogaWasm,
	readBundledIconBytes,
} from '#src/og-assets.ts'

export const OG_WIDTH = 1200
export const OG_HEIGHT = 630
/** Full card height so the square mark sits flush on the bottom edge. */
export const OG_ICON_SIZE = OG_HEIGHT
/** 630 + 28 + 486 + 56 = 1200, so the row does not overflow the card. */
export const OG_TEXT_WIDTH = 486
export const OG_WORDMARK = 'kody.exchange'
export const OG_TAGLINE = 'Ephemeral chatrooms for agents'

const PAPER = '#f6efe3'
const INK = '#1c1610'
const MUTED = '#6b5e4e'

export type SatoriChild = string | SatoriElement
export type SatoriElement = {
	type: string
	props: {
		style?: Record<string, string | number>
		children?: SatoriChild | Array<SatoriChild>
		src?: string
		width?: number
		height?: number
	}
}

let wasmReady: Promise<void> | null = null

export function ensureOgWasmReady(): Promise<void> {
	if (!wasmReady) {
		wasmReady = Promise.all([initSatori(ogYogaWasm), initWasm(ogResvgWasm)])
			.then(() => undefined)
			.catch((error) => {
				wasmReady = null
				throw error
			})
	}
	return wasmReady
}

function bytesToPngDataUri(bytes: Uint8Array): string {
	let binary = ''
	for (const byte of bytes) {
		binary += String.fromCharCode(byte)
	}
	return `data:image/png;base64,${btoa(binary)}`
}

async function readR2ObjectBytes(object: {
	arrayBuffer?: () => Promise<ArrayBuffer>
	body?: ReadableStream | ArrayBuffer
}): Promise<Uint8Array> {
	if (typeof object.arrayBuffer === 'function') {
		return new Uint8Array(await object.arrayBuffer())
	}
	if (object.body instanceof ArrayBuffer) {
		return new Uint8Array(object.body)
	}
	if (object.body) {
		return new Uint8Array(await new Response(object.body).arrayBuffer())
	}
	throw new Error('R2 object has no body')
}

export async function loadIconBytes(env: AppEnv): Promise<Uint8Array> {
	const fromBlobs = await env.BLOBS.get('public/icon.png')
	if (fromBlobs) return readR2ObjectBytes(fromBlobs)
	if (env.ASSETS) {
		const response = await env.ASSETS.fetch(
			new Request('https://assets.local/icon.png'),
		)
		if (response.ok) return new Uint8Array(await response.arrayBuffer())
	}
	const bundled = readBundledIconBytes()
	if (bundled) return bundled
	throw new Error('OG icon missing: public/icon.png')
}

export async function loadIconDataUri(env: AppEnv): Promise<string> {
	return bytesToPngDataUri(await loadIconBytes(env))
}

export function createOgMarkup(iconDataUri: string): SatoriElement {
	return {
		type: 'div',
		props: {
			style: {
				width: OG_WIDTH,
				height: OG_HEIGHT,
				display: 'flex',
				alignItems: 'flex-end',
				backgroundColor: PAPER,
				paddingRight: 56,
				gap: 28,
			},
			children: [
				{
					type: 'img',
					props: {
						src: iconDataUri,
						width: OG_ICON_SIZE,
						height: OG_ICON_SIZE,
						style: {
							width: OG_ICON_SIZE,
							height: OG_ICON_SIZE,
							flexShrink: 0,
							objectFit: 'contain',
							objectPosition: 'bottom left',
						},
					},
				},
				{
					type: 'div',
					props: {
						style: {
							display: 'flex',
							flexDirection: 'column',
							justifyContent: 'center',
							alignSelf: 'center',
							width: OG_TEXT_WIDTH,
						},
						children: [
							{
								type: 'div',
								props: {
									style: {
										fontFamily: 'Fraunces',
										fontWeight: 700,
										fontSize: 68,
										lineHeight: 1.05,
										letterSpacing: '-0.03em',
										color: INK,
										marginBottom: 18,
									},
									children: OG_WORDMARK,
								},
							},
							{
								type: 'div',
								props: {
									style: {
										fontFamily: 'Source Serif 4',
										fontWeight: 400,
										fontSize: 32,
										lineHeight: 1.35,
										color: MUTED,
									},
									children: OG_TAGLINE,
								},
							},
						],
					},
				},
			],
		},
	}
}

export function findOgIconElement(markup: SatoriElement): SatoriElement | null {
	if (markup.type === 'img') return markup
	const children = markup.props.children
	const list = Array.isArray(children) ? children : children ? [children] : []
	for (const child of list) {
		if (typeof child === 'string') continue
		const found = findOgIconElement(child)
		if (found) return found
	}
	return null
}

export async function renderExchangeOgImage(
	env: AppEnv,
): Promise<Uint8Array<ArrayBuffer>> {
	await Promise.all([
		ensureOgWasmReady(),
		ensureOgFontsReady({ assets: env.ASSETS }),
	])

	const markup = createOgMarkup(await loadIconDataUri(env))
	const displayFont = getFraunces700FontData()
	const bodyFont = getSourceSerif400FontData()
	const svg = await satori(markup, {
		width: OG_WIDTH,
		height: OG_HEIGHT,
		fonts: [
			{
				name: 'Fraunces',
				data: displayFont,
				weight: 700,
				style: 'normal',
			},
			{
				name: 'Source Serif 4',
				data: bodyFont,
				weight: 400,
				style: 'normal',
			},
		],
	})

	const resvg = new Resvg(svg, {
		fitTo: { mode: 'width', value: OG_WIDTH },
		font: {
			fontBuffers: [new Uint8Array(displayFont), new Uint8Array(bodyFont)],
			defaultFontFamily: 'Source Serif 4',
			serifFamily: 'Source Serif 4',
		},
	})
	const rendered = resvg.render()
	const png = rendered.asPng()
	rendered.free()
	resvg.free()
	return png as Uint8Array<ArrayBuffer>
}

export async function ogImageResponse(env: AppEnv): Promise<Response> {
	const png = await renderExchangeOgImage(env)
	return new Response(png, {
		headers: {
			'content-type': 'image/png',
			'cache-control': 'public, max-age=3600',
		},
	})
}
