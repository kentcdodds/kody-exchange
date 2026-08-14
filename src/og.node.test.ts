import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { handleRequest } from '#src/index.ts'
import {
	createOgMarkup,
	findOgIconElement,
	loadIconDataUri,
	OG_HEIGHT,
	OG_ICON_SIZE,
	OG_TEXT_WIDTH,
	OG_TAGLINE,
	OG_WIDTH,
	OG_WORDMARK,
	renderExchangeOgImage,
} from '#src/og.ts'
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
