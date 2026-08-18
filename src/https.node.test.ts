import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { applySecurityHeaders, httpsRedirect } from '#src/https.ts'
import { handleRequest } from '#src/index.ts'
import { createTestEnv } from '#src/test-support.ts'
import worker from '#src/worker.ts'

function executionContext(): ExecutionContext {
	return {
		waitUntil() {},
		passThroughOnException() {},
		props: {},
	} as unknown as ExecutionContext
}

test('production HTTP requests 301 to the HTTPS equivalent', async () => {
	const env = createTestEnv()
	const ctx = executionContext()
	const home = await worker.fetch(
		new Request('http://kody.exchange/'),
		env,
		ctx,
	)
	expect(home.status).toBe(301)
	expect(home.headers.get('location')).toBe('https://kody.exchange/')

	const docs = httpsRedirect(
		new Request('http://kody.exchange/docs?from=scan#top'),
	)
	expect(docs?.status).toBe(301)
	expect(docs?.headers.get('location')).toBe(
		'https://kody.exchange/docs?from=scan#top',
	)

	const health = await handleRequest(
		new Request('http://kody.exchange/health'),
		env,
	)
	expect(health.status).toBe(301)
	expect(health.headers.get('location')).toBe('https://kody.exchange/health')
})

test('localhost HTTP is left alone for wrangler dev', async () => {
	const env = createTestEnv()
	const ctx = executionContext()
	const local = await worker.fetch(
		new Request('http://localhost:8787/health'),
		env,
		ctx,
	)
	expect(local.status).toBe(200)
	expect(httpsRedirect(new Request('http://127.0.0.1:8787/'))).toBeNull()
	expect(httpsRedirect(new Request('https://kody.exchange/'))).toBeNull()
})

test('HTTPS responses send HSTS and nosniff', () => {
	const request = new Request('https://kody.exchange/')
	const secured = applySecurityHeaders(
		request,
		new Response('ok', { headers: { 'content-type': 'text/plain' } }),
	)
	expect(secured.headers.get('strict-transport-security')).toBe(
		'max-age=31536000; includeSubDomains; preload',
	)
	expect(secured.headers.get('x-content-type-options')).toBe('nosniff')
	expect(
		applySecurityHeaders(
			new Request('http://localhost:8787/'),
			new Response('ok'),
		).headers.get('strict-transport-security'),
	).toBeNull()

	const overwritten = applySecurityHeaders(
		request,
		new Response('ok', {
			headers: {
				'strict-transport-security': 'max-age=0',
				'x-content-type-options': 'invalid',
			},
		}),
	)
	expect(overwritten.headers.get('strict-transport-security')).toBe(
		'max-age=31536000; includeSubDomains; preload',
	)
	expect(overwritten.headers.get('x-content-type-options')).toBe('nosniff')
})

test('static assets run through the worker so HTTP can 301', () => {
	const config = readFileSync(
		join(dirname(fileURLToPath(import.meta.url)), '../wrangler.jsonc'),
		'utf8',
	)
	expect(config).toMatch(/"run_worker_first":\s*true/)
})
