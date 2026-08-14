import { expect, test } from 'vitest'
import { handleRequest } from '#src/index.ts'
import { oauthPaths } from '#src/oauth-paths.ts'
import { type OAuthAuthRequest, type OAuthHelpers } from '#src/oauth-user.ts'
import {
	createSignedInUser,
	createTestEnv,
	request,
} from '#src/test-support.ts'

function authRequest(
	overrides: Partial<OAuthAuthRequest> = {},
): OAuthAuthRequest {
	return {
		responseType: 'code',
		clientId: 'client_1',
		redirectUri: 'https://kody.codes/connect/oauth',
		scope: ['profile', 'threads'],
		state: 'state-1',
		codeChallenge: 'abc',
		codeChallengeMethod: 'S256',
		...overrides,
	}
}

function mockHelpers(
	overrides: Partial<OAuthHelpers> = {},
	requestInfo: OAuthAuthRequest = authRequest(),
): OAuthHelpers {
	return {
		parseAuthRequest: async () => requestInfo,
		lookupClient: async () => ({
			clientId: requestInfo.clientId,
			clientName: 'kody.codes',
		}),
		completeAuthorization: async () => ({
			redirectTo: 'https://kody.codes/connect/oauth?code=ok&state=state-1',
		}),
		unwrapToken: async () => null,
		...overrides,
	}
}

test('protected resource metadata advertises /mcp', async () => {
	const env = createTestEnv()
	const response = await handleRequest(
		request(oauthPaths.protectedResource),
		env,
	)
	expect(response.status).toBe(200)
	const body = (await response.json()) as {
		resource: string
		authorization_servers: Array<string>
		scopes_supported: Array<string>
	}
	expect(body.resource).toBe('https://kody.exchange/mcp')
	expect(body.authorization_servers).toEqual(['https://kody.exchange'])
	expect(body.scopes_supported).toContain('threads')
})

test('unauthenticated MCP and /api return 401 with WWW-Authenticate', async () => {
	const env = createTestEnv()
	const mcp = await handleRequest(
		request('/mcp', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
		}),
		env,
	)
	expect(mcp.status).toBe(401)
	expect(mcp.headers.get('www-authenticate')).toContain(
		'resource_metadata="https://kody.exchange/.well-known/oauth-protected-resource"',
	)

	const api = await handleRequest(request('/api/me'), env)
	expect(api.status).toBe(401)
})

test('authorize redirects signed-out users to GitHub with next', async () => {
	const env = createTestEnv({
		OAUTH_PROVIDER: mockHelpers(),
	})
	const response = await handleRequest(
		request(`${oauthPaths.authorize}?client_id=client_1`),
		env,
	)
	expect(response.status).toBe(302)
	const location = response.headers.get('location') ?? ''
	expect(location).toContain('/auth/github?')
	expect(location).toContain('next=%2Foauth%2Fauthorize')
})

test('signed-in owner can approve an OAuth client', async () => {
	const env = createTestEnv({
		OAUTH_PROVIDER: mockHelpers(),
	})
	const owner = await createSignedInUser(env)
	const page = await handleRequest(
		request(oauthPaths.authorize, { headers: { cookie: owner.cookie } }),
		env,
	)
	expect(page.status).toBe(200)
	const html = await page.text()
	expect(html).toContain('kody.codes')
	expect(html).toContain('Allow')

	const approved = await handleRequest(
		request(`${oauthPaths.authorize}?client_id=client_1`, {
			method: 'POST',
			headers: {
				cookie: owner.cookie,
				'content-type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				csrf: owner.csrf,
				decision: 'approve',
			}),
		}),
		env,
	)
	expect(approved.status).toBe(302)
	expect(approved.headers.get('location')).toBe(
		'https://kody.codes/connect/oauth?code=ok&state=state-1',
	)
})

test('OAuth user API creates, lists, sends, and sets a webhook', async () => {
	const env = createTestEnv()
	const owner = await createSignedInUser(env)
	env.OAUTH_USER = owner.user

	const created = await handleRequest(
		request('/api/threads', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ purpose: 'oauth thread', name: 'host' }),
		}),
		env,
	)
	expect(created.status).toBe(200)
	const createdBody = (await created.json()) as {
		ok: boolean
		thread: { id: string }
		token: string
		join_token: string
		view_url: string
	}
	expect(createdBody.ok).toBe(true)
	expect(createdBody.thread.id).toMatch(/^th_/)
	expect(createdBody.token).toMatch(/^kx_live_/)
	expect(createdBody.view_url).toContain('/t/')

	const listed = await handleRequest(request('/api/threads'), env)
	const listedBody = (await listed.json()) as {
		threads: Array<{ id: string }>
	}
	expect(listedBody.threads.map((thread) => thread.id)).toContain(
		createdBody.thread.id,
	)

	const sent = await handleRequest(
		request(`/api/threads/${createdBody.thread.id}/messages`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ body: { text: 'from oauth' } }),
		}),
		env,
	)
	expect(sent.status).toBe(200)
	const sentBody = (await sent.json()) as {
		ok: boolean
		message: { id: string }
	}
	expect(sentBody.ok).toBe(true)

	const webhook = await handleRequest(
		request(`/api/threads/${createdBody.thread.id}/webhook`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				url: 'https://kody.codes/@kentcdodds/webhooks/exchange-threads/thread-message/secret',
			}),
		}),
		env,
	)
	expect(webhook.status).toBe(200)

	const webhookCalls: Array<string> = []
	const originalFetch = globalThis.fetch
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		webhookCalls.push(String(input))
		return new Response('ok')
	}) as typeof fetch
	try {
		const resent = await handleRequest(
			request(`/api/threads/${createdBody.thread.id}/messages`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ body: { text: 'webhook please' } }),
			}),
			env,
		)
		expect(resent.status).toBe(200)
		expect(webhookCalls.some((url) => url.includes('kody.codes'))).toBe(true)
	} finally {
		globalThis.fetch = originalFetch
	}

	const mcp = await handleRequest(
		request('/mcp', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: { name: 'list_threads', arguments: {} },
			}),
		}),
		env,
	)
	expect(mcp.status).toBe(200)
	const rpc = (await mcp.json()) as {
		result: { content: Array<{ text: string }> }
	}
	const payload = JSON.parse(rpc.result.content[0]?.text ?? '{}') as {
		ok: boolean
		threads: Array<{ id: string }>
	}
	expect(payload.ok).toBe(true)
	expect(payload.threads.map((thread) => thread.id)).toContain(
		createdBody.thread.id,
	)
})
