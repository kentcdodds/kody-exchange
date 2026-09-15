import { expect, test } from 'vitest'
import { handleRequest } from '#src/index.ts'
import { createTestEnv, request } from '#src/test-support.ts'

const r2InternalError = new Error(
	'get: We encountered an internal error. Please try again. (10001)',
)

function throwingBlobs(): R2Bucket {
	return {
		async get() {
			throw r2InternalError
		},
	} as unknown as R2Bucket
}

function assetsFetcher(body: string, status = 200): Fetcher {
	return {
		async fetch() {
			return new Response(body, {
				status,
				headers: { 'content-type': 'image/png' },
			})
		},
	} as unknown as Fetcher
}

test('favicon.png and icon.png serve from R2 when the object exists', async () => {
	const env = createTestEnv({
		ASSETS: assetsFetcher('from-assets'),
	})
	await env.BLOBS.put(
		'public/favicon.png',
		new TextEncoder().encode('from-r2-favicon'),
		{ httpMetadata: { contentType: 'image/png' } },
	)
	await env.BLOBS.put(
		'public/icon.png',
		new TextEncoder().encode('from-r2-icon'),
		{ httpMetadata: { contentType: 'image/png' } },
	)

	const favicon = await handleRequest(request('/favicon.png'), env)
	expect(favicon.status).toBe(200)
	expect(favicon.headers.get('content-type')).toBe('image/png')
	expect(await favicon.text()).toBe('from-r2-favicon')

	const icon = await handleRequest(request('/icon.png'), env)
	expect(icon.status).toBe(200)
	expect(await icon.text()).toBe('from-r2-icon')
})

test('favicon.png and icon.png fall through to ASSETS when R2 get throws', async () => {
	const env = createTestEnv({
		BLOBS: throwingBlobs(),
		ASSETS: assetsFetcher('from-assets'),
	})

	const favicon = await handleRequest(request('/favicon.png'), env)
	expect(favicon.status).toBe(200)
	expect(await favicon.text()).toBe('from-assets')

	const icon = await handleRequest(request('/icon.png'), env)
	expect(icon.status).toBe(200)
	expect(await icon.text()).toBe('from-assets')
})

test('favicon.png is not 500 when R2 get throws and ASSETS is unset', async () => {
	const env = createTestEnv({
		BLOBS: throwingBlobs(),
	})
	const favicon = await handleRequest(request('/favicon.png'), env)
	expect(favicon.status).not.toBe(500)
	expect(favicon.status).toBe(404)
})
