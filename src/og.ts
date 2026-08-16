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
import {
	PAGE_OG_CACHE_MAX_AGE_SECONDS,
	VIEW_OG_CACHE_MAX_AGE_SECONDS,
	pageOgById,
	pageOgCacheKey,
	viewOgCacheKey,
	viewOgLede,
	viewOgTitle,
	type OgCardId,
	type PageOgSpec,
} from '#src/og-pages.ts'

export const OG_WIDTH = 1200
export const OG_HEIGHT = 630
/** Full card height so the square mark sits flush on the bottom edge. */
export const OG_ICON_SIZE = OG_HEIGHT
/** 630 + 28 + 486 + 56 = 1200, so the row does not overflow the card. */
export const OG_TEXT_WIDTH = 486
export const OG_WORDMARK = 'kody.exchange'
export const OG_TAGLINE = 'Ephemeral chatrooms for agents'

const PAPER = '#f6efe3'
const CARD = '#fffaf1'
const INK = '#1c1610'
const MUTED = '#6b5e4e'
const AMBER = '#d4921a'
const STAMP = '#b54a3c'
const LINE = '#d7cbb6'

export const RESEARCH_OG_ICON_SIZE = 72
export const RESEARCH_OG_STAMP = 'Technical report  ·  15 August 2026'
export const RESEARCH_OG_TITLE_LINE_1 = 'Peer-channel security'
export const RESEARCH_OG_TITLE_LINE_2 = 'and privacy'
export const RESEARCH_OG_TITLE = `${RESEARCH_OG_TITLE_LINE_1} ${RESEARCH_OG_TITLE_LINE_2}`
export const RESEARCH_OG_STATS = [
	{ value: '261', label: 'turns' },
	{ value: '6', label: 'live rooms' },
	{ value: '0', label: 'leaks' },
] as const
export type OgCard = OgCardId

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

function titleLines(
	spec: Pick<PageOgSpec, 'title' | 'titleLine2'>,
): SatoriElement {
	const lines = spec.titleLine2 ? [spec.title, spec.titleLine2] : [spec.title]
	return {
		type: 'div',
		props: {
			style: {
				display: 'flex',
				flexDirection: 'column',
				marginTop: 28,
				fontFamily: 'Fraunces',
				fontWeight: 700,
				fontSize: spec.titleLine2 ? 64 : 72,
				lineHeight: 1.05,
				letterSpacing: '-0.03em',
				color: INK,
			},
			children: lines.map((line) => ({
				type: 'div',
				props: {
					style: { display: 'flex' },
					children: line,
				},
			})),
		},
	}
}

function ogReportCard(input: {
	iconDataUri: string
	stamp: string
	title: SatoriElement
	middle: SatoriElement
}): SatoriElement {
	return {
		type: 'div',
		props: {
			style: {
				width: OG_WIDTH,
				height: OG_HEIGHT,
				display: 'flex',
				backgroundColor: PAPER,
			},
			children: [
				{
					type: 'div',
					props: {
						style: {
							width: 16,
							height: OG_HEIGHT,
							flexShrink: 0,
							backgroundColor: AMBER,
						},
					},
				},
				{
					type: 'div',
					props: {
						style: {
							display: 'flex',
							flexDirection: 'column',
							justifyContent: 'space-between',
							flexGrow: 1,
							height: OG_HEIGHT,
							padding: '52px 64px 44px 56px',
							backgroundColor: CARD,
						},
						children: [
							{
								type: 'div',
								props: {
									style: {
										display: 'flex',
										flexDirection: 'column',
									},
									children: [
										{
											type: 'div',
											props: {
												style: {
													display: 'flex',
													alignSelf: 'flex-start',
													borderWidth: 2,
													borderStyle: 'dashed',
													borderColor: STAMP,
													color: STAMP,
													padding: '8px 14px',
													fontFamily: 'Source Serif 4',
													fontWeight: 400,
													fontSize: 22,
													letterSpacing: '0.08em',
												},
												children: input.stamp,
											},
										},
										input.title,
									],
								},
							},
							input.middle,
							{
								type: 'div',
								props: {
									style: {
										display: 'flex',
										alignItems: 'center',
										marginTop: 36,
										paddingTop: 22,
										borderTopWidth: 1,
										borderTopStyle: 'solid',
										borderTopColor: LINE,
									},
									children: [
										{
											type: 'img',
											props: {
												src: input.iconDataUri,
												width: RESEARCH_OG_ICON_SIZE,
												height: RESEARCH_OG_ICON_SIZE,
												style: {
													width: RESEARCH_OG_ICON_SIZE,
													height: RESEARCH_OG_ICON_SIZE,
													flexShrink: 0,
													objectFit: 'contain',
												},
											},
										},
										{
											type: 'div',
											props: {
												style: {
													display: 'flex',
													marginLeft: 14,
													fontFamily: 'Fraunces',
													fontWeight: 700,
													fontSize: 28,
													letterSpacing: '-0.02em',
													color: INK,
												},
												children: OG_WORDMARK,
											},
										},
									],
								},
							},
						],
					},
				},
			],
		},
	}
}

function researchStat(value: string, label: string): SatoriElement {
	return {
		type: 'div',
		props: {
			style: {
				display: 'flex',
				flexDirection: 'column',
				width: 220,
			},
			children: [
				{
					type: 'div',
					props: {
						style: {
							display: 'flex',
							fontFamily: 'Fraunces',
							fontWeight: 700,
							fontSize: 72,
							lineHeight: 1,
							letterSpacing: '-0.03em',
							color: INK,
						},
						children: value,
					},
				},
				{
					type: 'div',
					props: {
						style: {
							display: 'flex',
							marginTop: 8,
							fontFamily: 'Source Serif 4',
							fontWeight: 400,
							fontSize: 26,
							lineHeight: 1.2,
							color: MUTED,
						},
						children: label,
					},
				},
			],
		},
	}
}

export function createResearchOgMarkup(iconDataUri: string): SatoriElement {
	const spec = pageOgById('research')
	return ogReportCard({
		iconDataUri,
		stamp: spec.stamp,
		title: titleLines(spec),
		middle: {
			type: 'div',
			props: {
				style: {
					display: 'flex',
					flexDirection: 'row',
					marginTop: 36,
				},
				children: RESEARCH_OG_STATS.map((stat) =>
					researchStat(stat.value, stat.label),
				),
			},
		},
	})
}

export function createPageOgMarkup(
	iconDataUri: string,
	spec: Pick<PageOgSpec, 'stamp' | 'title' | 'titleLine2' | 'lede'>,
): SatoriElement {
	return ogReportCard({
		iconDataUri,
		stamp: spec.stamp,
		title: titleLines(spec),
		middle: {
			type: 'div',
			props: {
				style: {
					display: 'flex',
					marginTop: 36,
					fontFamily: 'Source Serif 4',
					fontWeight: 400,
					fontSize: 32,
					lineHeight: 1.35,
					color: MUTED,
					width: 980,
				},
				children: spec.lede,
			},
		},
	})
}

export type ViewOgCard = {
	viewToken: string
	purpose: string | null
	members: Array<{ name: string }>
	seats: number
	expiresAt: number
}

export function createViewOgMarkup(
	iconDataUri: string,
	card: ViewOgCard,
): SatoriElement {
	return createPageOgMarkup(iconDataUri, {
		stamp: 'Read-only',
		title: viewOgTitle(card.purpose),
		lede: viewOgLede(card),
	})
}

export function createOgMarkupForSpec(
	iconDataUri: string,
	spec: PageOgSpec,
): SatoriElement {
	switch (spec.kind) {
		case 'hero':
			return createOgMarkup(iconDataUri)
		case 'research':
			return createResearchOgMarkup(iconDataUri)
		case 'page':
			return createPageOgMarkup(iconDataUri, spec)
		default: {
			const exhaustive: never = spec.kind
			throw new Error(`Unknown OG kind: ${String(exhaustive)}`)
		}
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

async function renderOgPng(
	env: AppEnv,
	markup: SatoriElement,
): Promise<Uint8Array<ArrayBuffer>> {
	await Promise.all([
		ensureOgWasmReady(),
		ensureOgFontsReady({ assets: env.ASSETS }),
	])

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

export type OgImageCache = Pick<Cache, 'match' | 'put'>

const ogCacheOrigin = 'https://og-cache.kody.exchange'

export function workerOgCache(): OgImageCache | null {
	try {
		return typeof caches === 'undefined' ? null : caches.default
	} catch {
		return null
	}
}

export function ogCacheRequest(key: string) {
	return new Request(`${ogCacheOrigin}/${encodeURIComponent(key)}`)
}

function pngImageResponse(
	png: Uint8Array<ArrayBuffer>,
	maxAgeSeconds: number,
): Response {
	return new Response(png, {
		headers: {
			'content-type': 'image/png',
			'cache-control': `public, max-age=${maxAgeSeconds}`,
		},
	})
}

export async function cachedOgPng(input: {
	cache?: OgImageCache | null
	key: string
	maxAgeSeconds: number
	render: () => Promise<Uint8Array<ArrayBuffer>>
}): Promise<Response> {
	const cache = input.cache === undefined ? workerOgCache() : input.cache
	const request = ogCacheRequest(input.key)
	const hit = cache ? await cache.match(request) : undefined
	if (hit) return hit
	const response = pngImageResponse(await input.render(), input.maxAgeSeconds)
	if (cache) await cache.put(request, response.clone())
	return response
}

export async function renderOgCard(
	env: AppEnv,
	card: OgCard = 'exchange',
): Promise<Uint8Array<ArrayBuffer>> {
	const spec = pageOgById(card)
	return renderOgPng(
		env,
		createOgMarkupForSpec(await loadIconDataUri(env), spec),
	)
}

export async function renderViewOgImage(
	env: AppEnv,
	card: ViewOgCard,
): Promise<Uint8Array<ArrayBuffer>> {
	return renderOgPng(env, createViewOgMarkup(await loadIconDataUri(env), card))
}

export async function renderExchangeOgImage(
	env: AppEnv,
): Promise<Uint8Array<ArrayBuffer>> {
	return renderOgCard(env, 'exchange')
}

export async function renderResearchOgImage(
	env: AppEnv,
): Promise<Uint8Array<ArrayBuffer>> {
	return renderOgCard(env, 'research')
}

export async function ogImageResponse(
	env: AppEnv,
	card: OgCard = 'exchange',
	cache?: OgImageCache | null,
): Promise<Response> {
	return cachedOgPng({
		cache,
		key: pageOgCacheKey(card),
		maxAgeSeconds: PAGE_OG_CACHE_MAX_AGE_SECONDS,
		render: () => renderOgCard(env, card),
	})
}

export async function viewOgImageResponse(
	env: AppEnv,
	card: ViewOgCard,
	cache?: OgImageCache | null,
): Promise<Response> {
	return cachedOgPng({
		cache,
		key: viewOgCacheKey(card),
		maxAgeSeconds: VIEW_OG_CACHE_MAX_AGE_SECONDS,
		render: () => renderViewOgImage(env, card),
	})
}
