import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { handleRequest } from '#src/index.ts'
import {
	cachedOgPng,
	createOgMarkup,
	createOgMarkupForSpec,
	createPageOgMarkup,
	createResearchOgMarkup,
	createViewOgMarkup,
	findOgIconElement,
	loadIconDataUri,
	OG_HEIGHT,
	OG_ICON_SIZE,
	OG_TEXT_WIDTH,
	OG_TAGLINE,
	OG_WIDTH,
	OG_WORDMARK,
	RESEARCH_OG_ICON_SIZE,
	RESEARCH_OG_STAMP,
	RESEARCH_OG_STATS,
	RESEARCH_OG_TITLE,
	RESEARCH_OG_TITLE_LINE_1,
	RESEARCH_OG_TITLE_LINE_2,
	renderExchangeOgImage,
	renderOgCard,
	renderResearchOgImage,
} from '#src/og.ts'
import { pageOgById, pageOgSpecs } from '#src/og-pages.ts'
import { createTestEnv, request } from '#src/test-support.ts'

const publicIcon = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), '../public/icon.png'),
)

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

function readPngDimensions(bytes: Uint8Array) {
	const header = String.fromCharCode(...bytes.slice(12, 16))
	if (
		bytes.byteLength < 24 ||
		!PNG_MAGIC.every((byte, index) => bytes[index] === byte) ||
		header !== 'IHDR'
	) {
		throw new Error('expected a PNG')
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	return {
		width: view.getUint32(16),
		height: view.getUint32(20),
	}
}

function expectPngCard(bytes: Uint8Array) {
	expect(bytes.byteLength).toBeGreaterThan(10_000)
	expect(readPngDimensions(bytes)).toEqual({
		width: OG_WIDTH,
		height: OG_HEIGHT,
	})
}

test('OG markup keeps Kody square and uses the site copy', () => {
	const markup = createOgMarkup('data:image/png;base64,abc')
	const icon = findOgIconElement(markup)
	expect(icon).not.toBeNull()
	expect(OG_ICON_SIZE).toBe(OG_HEIGHT)
	expect(icon?.props.width).toBe(OG_ICON_SIZE)
	expect(icon?.props.height).toBe(OG_ICON_SIZE)
	expect(icon?.props.width).toBe(icon?.props.height)
	expect(icon?.props.style?.width).toBe(OG_ICON_SIZE)
	expect(icon?.props.style?.height).toBe(OG_ICON_SIZE)
	expect(icon?.props.style?.objectFit).toBe('contain')
	expect(icon?.props.style?.objectPosition).toBe('bottom left')
	expect(icon?.props.style?.flexShrink).toBe(0)
	expect(markup.props.style?.alignItems).toBe('flex-end')
	expect(markup.props.style?.paddingBottom ?? 0).toBe(0)
	const children = markup.props.children
	const text = Array.isArray(children) ? children[1] : null
	expect(
		text && typeof text !== 'string' ? text.props.style?.alignSelf : null,
	).toBe('center')
	expect(
		text && typeof text !== 'string' ? text.props.style?.width : null,
	).toBe(OG_TEXT_WIDTH)
	expect(OG_ICON_SIZE + 28 + OG_TEXT_WIDTH + 56).toBe(OG_WIDTH)

	const tree = JSON.stringify(markup)
	expect(tree).toContain(OG_WORDMARK)
	expect(tree).toContain(OG_TAGLINE)
	expect(tree).toContain('#f6efe3')
})

test('renderExchangeOgImage returns a 1200×630 PNG', async () => {
	const env = createTestEnv()
	await env.BLOBS.put(
		'public/icon.png',
		publicIcon.buffer.slice(
			publicIcon.byteOffset,
			publicIcon.byteOffset + publicIcon.byteLength,
		),
		{ httpMetadata: { contentType: 'image/png' } },
	)
	const png = await renderExchangeOgImage(env)
	expect(png.byteLength).toBeGreaterThan(10_000)
	expectPngCard(png)
})

test('research OG markup is a report card, not the homepage mark', () => {
	const markup = createResearchOgMarkup('data:image/png;base64,abc')
	const icon = findOgIconElement(markup)
	expect(icon).not.toBeNull()
	expect(RESEARCH_OG_ICON_SIZE).toBeLessThan(OG_HEIGHT)
	expect(icon?.props.width).toBe(RESEARCH_OG_ICON_SIZE)
	expect(icon?.props.height).toBe(RESEARCH_OG_ICON_SIZE)
	expect(markup.props.style?.alignItems).not.toBe('flex-end')

	const tree = JSON.stringify(markup)
	expect(tree).toContain(RESEARCH_OG_STAMP)
	expect(tree).toContain(RESEARCH_OG_TITLE_LINE_1)
	expect(tree).toContain(RESEARCH_OG_TITLE_LINE_2)
	expect(RESEARCH_OG_TITLE).toBe(
		`${RESEARCH_OG_TITLE_LINE_1} ${RESEARCH_OG_TITLE_LINE_2}`,
	)
	expect(tree).toContain(OG_WORDMARK)
	expect(tree).not.toContain(OG_TAGLINE)
	for (const stat of RESEARCH_OG_STATS) {
		expect(tree).toContain(stat.value)
		expect(tree).toContain(stat.label)
	}
	expect(pageOgById('research').stamp).toBe(RESEARCH_OG_STAMP)
	expect(pageOgById('research').title).toBe(RESEARCH_OG_TITLE_LINE_1)
	expect(pageOgById('research').titleLine2).toBe(RESEARCH_OG_TITLE_LINE_2)
	expect(tree).toContain('#d4921a')
	expect(tree).toContain('#b54a3c')
	expect(tree).toContain('#fffaf1')
})

test('renderResearchOgImage returns a 1200×630 PNG', async () => {
	const env = createTestEnv()
	await env.BLOBS.put(
		'public/icon.png',
		publicIcon.buffer.slice(
			publicIcon.byteOffset,
			publicIcon.byteOffset + publicIcon.byteLength,
		),
		{ httpMetadata: { contentType: 'image/png' } },
	)
	const png = await renderResearchOgImage(env)
	expect(png.byteLength).toBeGreaterThan(10_000)
	expectPngCard(png)
})

test('page OG markup is a report card with stamp, title, and lede', () => {
	const spec = pageOgById('example')
	const markup = createPageOgMarkup('data:image/png;base64,abc', spec)
	const tree = JSON.stringify(markup)
	expect(tree).toContain(spec.stamp)
	expect(tree).toContain(spec.title)
	expect(tree).toContain(spec.lede)
	expect(tree).toContain(OG_WORDMARK)
	expect(tree).not.toContain(OG_TAGLINE)
	expect(markup.props.style?.alignItems).not.toBe('flex-end')
})

test('createOgMarkupForSpec keeps homepage and research cards distinct', () => {
	const hero = createOgMarkupForSpec(
		'data:image/png;base64,abc',
		pageOgById('exchange'),
	)
	const research = createOgMarkupForSpec(
		'data:image/png;base64,abc',
		pageOgById('research'),
	)
	const example = createOgMarkupForSpec(
		'data:image/png;base64,abc',
		pageOgById('example'),
	)
	expect(JSON.stringify(hero)).toContain(OG_TAGLINE)
	expect(JSON.stringify(research)).toContain(RESEARCH_OG_STAMP)
	expect(JSON.stringify(example)).toContain('Watch an example thread')
	expect(JSON.stringify(example)).not.toContain(OG_TAGLINE)
})

test('view OG markup uses purpose and roster, not join tokens', () => {
	const markup = createViewOgMarkup('data:image/png;base64,abc', {
		viewToken: `kx_view_${'b'.repeat(48)}`,
		purpose: 'pair on the billing webhook',
		members: [{ name: 'cursor' }, { name: 'claude' }],
		seats: 2,
		expiresAt: Date.parse('2026-04-09T00:00:00.000Z'),
	})
	const tree = JSON.stringify(markup)
	expect(tree).toContain('Read-only')
	expect(tree).toContain('pair on the billing webhook')
	expect(tree).toContain('2 of 2 · cursor, claude · expires 2026-04-09')
	expect(tree).toContain(OG_WORDMARK)
	expect(tree).not.toContain('kx_join_')
	expect(tree).not.toContain('kx_live_')
	expect(tree).not.toContain('kx_view_')
})

test('cachedOgPng renders once per key', async () => {
	const store = new Map<string, Response>()
	const cache = {
		async match(cached: Request) {
			const hit = store.get(cached.url)
			return hit?.clone()
		},
		async put(cached: Request, response: Response) {
			store.set(cached.url, response.clone())
		},
	}
	let renders = 0
	const png = new Uint8Array([1, 2, 3, 4]).buffer
	const render = async () => {
		renders += 1
		return new Uint8Array(png) as Uint8Array<ArrayBuffer>
	}
	const first = await cachedOgPng({
		cache,
		key: 'view:one',
		maxAgeSeconds: 300,
		render,
	})
	const second = await cachedOgPng({
		cache,
		key: 'view:one',
		maxAgeSeconds: 300,
		render,
	})
	const third = await cachedOgPng({
		cache,
		key: 'view:two',
		maxAgeSeconds: 300,
		render,
	})
	expect(renders).toBe(2)
	expect(first.headers.get('cache-control')).toBe('public, max-age=300')
	expect(await second.arrayBuffer()).toEqual(await first.arrayBuffer())
	expect(third.status).toBe(200)
})

test('every page OG card renders a 1200×630 PNG', async () => {
	const env = createTestEnv()
	await env.BLOBS.put(
		'public/icon.png',
		publicIcon.buffer.slice(
			publicIcon.byteOffset,
			publicIcon.byteOffset + publicIcon.byteLength,
		),
		{ httpMetadata: { contentType: 'image/png' } },
	)
	expect(pageOgSpecs.length).toBeGreaterThan(1)
	for (const spec of pageOgSpecs) {
		expectPngCard(await renderOgCard(env, spec.id))
	}
})

test('/og.png and /og.jpg both render the Satori card', async () => {
	const env = createTestEnv()
	const png = await handleRequest(request('/og.png'), env)
	expect(png.status).toBe(200)
	expect(png.headers.get('content-type')).toBe('image/png')
	expectPngCard(new Uint8Array(await png.arrayBuffer()))

	const legacy = await handleRequest(request('/og.jpg'), env)
	expect(legacy.status).toBe(200)
	expect(legacy.headers.get('content-type')).toBe('image/png')
	expectPngCard(new Uint8Array(await legacy.arrayBuffer()))
})

test('/safety/og.png and /safety/og.jpg both render the research card', async () => {
	const env = createTestEnv()
	const png = await handleRequest(request('/safety/og.png'), env)
	expect(png.status).toBe(200)
	expect(png.headers.get('content-type')).toBe('image/png')
	expectPngCard(new Uint8Array(await png.arrayBuffer()))

	const jpg = await handleRequest(request('/safety/og.jpg'), env)
	expect(jpg.status).toBe(200)
	expect(jpg.headers.get('content-type')).toBe('image/png')
	expectPngCard(new Uint8Array(await jpg.arrayBuffer()))
})

test('each public page OG route serves png and jpg aliases', async () => {
	const env = createTestEnv()
	for (const spec of pageOgSpecs) {
		const png = await handleRequest(request(spec.imagePath), env)
		expect(png.status).toBe(200)
		expect(png.headers.get('content-type')).toBe('image/png')
		expectPngCard(new Uint8Array(await png.arrayBuffer()))

		const jpgPath = spec.imagePath.replace(/\.png$/, '.jpg')
		const jpg = await handleRequest(request(jpgPath), env)
		expect(jpg.status).toBe(200)
		expect(jpg.headers.get('content-type')).toBe('image/png')
	}
})

test('thread view OG is a cached 1200×630 PNG from the purpose', async () => {
	const env = createTestEnv()
	const createdResponse = await handleRequest(
		request('/v1/threads', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				purpose: 'pair on the billing bug',
				name: 'cursor',
			}),
		}),
		env,
	)
	const created = (await createdResponse.json()) as { view_url: string }
	const viewPath = new URL(created.view_url).pathname
	const png = await handleRequest(request(`${viewPath}/og.png`), env)
	expect(png.status).toBe(200)
	expect(png.headers.get('content-type')).toBe('image/png')
	expect(png.headers.get('cache-control')).toBe('public, max-age=300')
	expectPngCard(new Uint8Array(await png.arrayBuffer()))

	const jpg = await handleRequest(request(`${viewPath}/og.jpg`), env)
	expect(jpg.status).toBe(200)
	expect(jpg.headers.get('content-type')).toBe('image/png')

	const missing = await handleRequest(
		request(`/t/kx_view_${'c'.repeat(48)}/og.png`),
		env,
	)
	expect(missing.status).toBe(404)
})

test('unknown page OG routes are not cards', async () => {
	const env = createTestEnv()
	const missing = await handleRequest(request('/missing/og.png'), env)
	expect(missing.status).toBe(404)
})

test('/research/og.png and /research/og.jpg redirect to /safety', async () => {
	const env = createTestEnv()
	const png = await handleRequest(request('/research/og.png'), env)
	expect(png.status).toBe(301)
	expect(png.headers.get('location')).toBe(
		'https://kody.exchange/safety/og.png',
	)

	const jpg = await handleRequest(request('/research/og.jpg'), env)
	expect(jpg.status).toBe(301)
	expect(jpg.headers.get('location')).toBe(
		'https://kody.exchange/safety/og.jpg',
	)
})

test('OG prefers the R2 mark over the bundled fallback', async () => {
	const env = createTestEnv()
	const oneByOnePng = Uint8Array.from([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
		0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
		0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
		0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4, 0xef, 0x00, 0x00,
		0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
	])
	await env.BLOBS.put(
		'public/icon.png',
		oneByOnePng.buffer.slice(
			oneByOnePng.byteOffset,
			oneByOnePng.byteOffset + oneByOnePng.byteLength,
		),
		{ httpMetadata: { contentType: 'image/png' } },
	)
	const dataUri = await loadIconDataUri(env)
	expect(dataUri.startsWith('data:image/png;base64,')).toBe(true)
	expect(dataUri.length).toBeLessThan(200)
})
