import { expect, test } from 'vitest'
import { handleRequest } from '#src/index.ts'
import { oauthPaths } from '#src/oauth-paths.ts'
import {
	audienceMatches,
	type OAuthAuthRequest,
	type OAuthHelpers,
	resolveAuthorizationResource,
	sharedProductResources,
} from '#src/oauth-user.ts'
import {
	createSignedInUser,
	createTestEnv,
	request,
} from '#src/test-support.ts'
import worker from '#src/worker.ts'

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

test('audienceMatches accepts origin, /mcp, /api, and trailing slashes', () => {
	const origin = 'https://kody.exchange'
	expect(audienceMatches(undefined, origin)).toBe(true)
	expect(audienceMatches(`${origin}/mcp`, origin)).toBe(true)
	expect(audienceMatches(`${origin}/mcp/`, origin)).toBe(true)
	expect(audienceMatches(origin, origin)).toBe(true)
	expect(audienceMatches(`${origin}/`, origin)).toBe(true)
	expect(audienceMatches(`${origin}/api`, origin)).toBe(true)
	expect(audienceMatches(`${origin}/api/`, origin)).toBe(true)
	expect(audienceMatches([`${origin}/`], origin)).toBe(true)
	expect(audienceMatches([`${origin}/api`], origin)).toBe(true)
	expect(audienceMatches(`${origin}/other`, origin)).toBe(false)
	expect(audienceMatches(['https://example.com'], origin)).toBe(false)
})

test('omitted or origin resource becomes the shared product audience', () => {
	const origin = 'https://kody.exchange'
	const shared = sharedProductResources(origin)
	expect(shared).toEqual([origin, `${origin}/api`, `${origin}/mcp`])
	expect(resolveAuthorizationResource(undefined, origin)).toEqual(shared)
	expect(resolveAuthorizationResource(origin, origin)).toEqual(shared)
	expect(resolveAuthorizationResource(`${origin}/`, origin)).toEqual(shared)
	expect(resolveAuthorizationResource(`${origin}/mcp`, origin)).toBe(
		`${origin}/mcp`,
	)
	expect(resolveAuthorizationResource(`${origin}/api`, origin)).toBe(
		`${origin}/api`,
	)
	expect(resolveAuthorizationResource('https://evil.example/mcp', origin)).toBe(
		'https://evil.example/mcp',
	)
})

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
	const apiBody = (await api.json()) as {
		error: string
		signup_url: string
		mcp_url: string
		hint: string
	}
	expect(apiBody.error).toContain('free account')
	expect(apiBody.error).not.toContain('Pro')
	expect(apiBody.signup_url).toBe('https://kody.exchange/auth/github')
	expect(apiBody.mcp_url).toBe('https://kody.exchange/mcp')
	expect(apiBody.hint).toContain('not a paid upgrade')
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

test('authorize without resource mints the shared product audience, not /mcp-only', async () => {
	const origin = 'https://kody.exchange'
	let completed: OAuthAuthRequest | undefined
	const env = createTestEnv({
		OAUTH_PROVIDER: mockHelpers({
			completeAuthorization: async (input) => {
				completed = input.request
				return {
					redirectTo: 'https://kody.codes/connect/oauth?code=ok&state=state-1',
				}
			},
		}),
	})
	const owner = await createSignedInUser(env)
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
	expect(completed?.resource).toEqual(sharedProductResources(origin))
	expect(completed?.resource).not.toBe(`${origin}/mcp`)
})

test('authorize with explicit /mcp keeps an MCP-scoped resource', async () => {
	let completed: OAuthAuthRequest | undefined
	const env = createTestEnv({
		OAUTH_PROVIDER: mockHelpers(
			{
				completeAuthorization: async (input) => {
					completed = input.request
					return {
						redirectTo:
							'https://kody.codes/connect/oauth?code=ok&state=state-1',
					}
				},
			},
			authRequest({ resource: 'https://kody.exchange/mcp' }),
		),
	})
	const owner = await createSignedInUser(env)
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
	expect(completed?.resource).toBe('https://kody.exchange/mcp')
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
	const waited: Array<Promise<unknown>> = []
	const ctx = {
		waitUntil(promise: Promise<unknown>) {
			waited.push(promise)
		},
	} as ExecutionContext
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
			ctx,
		)
		expect(resent.status).toBe(200)
		expect(waited.length).toBeGreaterThanOrEqual(1)
		await Promise.all(waited)
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

	const archived = await handleRequest(
		request(`/api/threads/${createdBody.thread.id}/archive`, {
			method: 'POST',
		}),
		env,
	)
	expect(archived.status).toBe(200)
	const archivedBody = (await archived.json()) as {
		ok: boolean
		thread: { archived: boolean }
	}
	expect(archivedBody.thread.archived).toBe(true)

	const listedAfter = await handleRequest(request('/api/threads'), env)
	const listedAfterBody = (await listedAfter.json()) as {
		threads: Array<{ id: string }>
	}
	expect(listedAfterBody.threads.map((thread) => thread.id)).not.toContain(
		createdBody.thread.id,
	)

	const mcpArchive = await handleRequest(
		request('/mcp', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 2,
				method: 'tools/call',
				params: {
					name: 'archive_thread',
					arguments: { thread_id: createdBody.thread.id },
				},
			}),
		}),
		env,
	)
	expect(mcpArchive.status).toBe(200)
	const mcpRpc = (await mcpArchive.json()) as {
		result: { content: Array<{ text: string }> }
	}
	const mcpPayload = JSON.parse(mcpRpc.result.content[0]?.text ?? '{}') as {
		ok: boolean
		thread: { archived: boolean }
	}
	expect(mcpPayload.ok).toBe(true)
	expect(mcpPayload.thread.archived).toBe(true)
})

test('OAuth user API can keep and hard-delete a thread', async () => {
	const env = createTestEnv()
	const owner = await createSignedInUser(env)
	env.OAUTH_USER = owner.user

	const created = await handleRequest(
		request('/api/threads', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ purpose: 'keep forever', name: 'host' }),
		}),
		env,
	)
	const createdBody = (await created.json()) as {
		ok: boolean
		thread: { id: string; never_expires: boolean; expires_at: string | null }
	}
	expect(createdBody.thread.never_expires).toBe(false)
	expect(createdBody.thread.expires_at).toBeTruthy()

	const kept = await handleRequest(
		request(`/api/threads/${createdBody.thread.id}/keep`, {
			method: 'POST',
		}),
		env,
	)
	expect(kept.status).toBe(200)
	const keptBody = (await kept.json()) as {
		ok: boolean
		thread: { never_expires: boolean; expires_at: string | null }
	}
	expect(keptBody.thread.never_expires).toBe(true)
	expect(keptBody.thread.expires_at).toBeNull()

	const listed = await handleRequest(request('/api/threads'), env)
	const listedBody = (await listed.json()) as {
		threads: Array<{ id: string; never_expires: boolean }>
	}
	expect(
		listedBody.threads.find((thread) => thread.id === createdBody.thread.id)
			?.never_expires,
	).toBe(true)

	const mcpKeep = await handleRequest(
		request('/mcp', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 3,
				method: 'tools/call',
				params: {
					name: 'keep_thread',
					arguments: { thread_id: createdBody.thread.id },
				},
			}),
		}),
		env,
	)
	expect(mcpKeep.status).toBe(200)

	const deleted = await handleRequest(
		request(`/api/threads/${createdBody.thread.id}/delete`, {
			method: 'POST',
		}),
		env,
	)
	expect(deleted.status).toBe(200)
	const deletedBody = (await deleted.json()) as {
		ok: boolean
		deleted: boolean
	}
	expect(deletedBody.deleted).toBe(true)

	const listedAfter = await handleRequest(request('/api/threads'), env)
	const listedAfterBody = (await listedAfter.json()) as {
		threads: Array<{ id: string }>
	}
	expect(listedAfterBody.threads.map((thread) => thread.id)).not.toContain(
		createdBody.thread.id,
	)

	const mcpDelete = await handleRequest(
		request('/mcp', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 4,
				method: 'tools/call',
				params: {
					name: 'delete_thread',
					arguments: { thread_id: createdBody.thread.id },
				},
			}),
		}),
		env,
	)
	expect(mcpDelete.status).toBe(200)
	const mcpRpc = (await mcpDelete.json()) as {
		result: { content: Array<{ text: string }> }
	}
	const mcpPayload = JSON.parse(mcpRpc.result.content[0]?.text ?? '{}') as {
		ok: boolean
		code?: string
	}
	expect(mcpPayload.ok).toBe(false)
	expect(mcpPayload.code).toBe('not_found')
})

function executionContext(): ExecutionContext {
	return {
		waitUntil() {},
		passThroughOnException() {},
		props: {},
	} as unknown as ExecutionContext
}

async function pkcePair() {
	const verifierBytes = crypto.getRandomValues(new Uint8Array(32))
	const verifier = Buffer.from(verifierBytes).toString('base64url')
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(verifier),
	)
	return { verifier, challenge: Buffer.from(digest).toString('base64url') }
}

type TokenResponse = {
	access_token: string
	refresh_token?: string
	token_type?: string
	resource?: string | Array<string>
	error?: string
	error_description?: string
}

async function registerPublicClient(env: ReturnType<typeof createTestEnv>) {
	const response = await worker.fetch(
		request(oauthPaths.register, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				client_name: 'kody.codes',
				redirect_uris: ['https://kody.codes/connect/oauth'],
				token_endpoint_auth_method: 'none',
				grant_types: ['authorization_code', 'refresh_token'],
				response_types: ['code'],
			}),
		}),
		env,
		executionContext(),
	)
	expect(response.status).toBe(201)
	return (await response.json()) as { client_id: string }
}

async function approveAuthorization(
	env: ReturnType<typeof createTestEnv>,
	input: {
		clientId: string
		challenge: string
		resource?: string
	},
) {
	const owner = await createSignedInUser(env)
	const authorize = new URL('https://kody.exchange/oauth/authorize')
	authorize.searchParams.set('response_type', 'code')
	authorize.searchParams.set('client_id', input.clientId)
	authorize.searchParams.set('redirect_uri', 'https://kody.codes/connect/oauth')
	authorize.searchParams.set('scope', 'profile threads')
	authorize.searchParams.set('state', 'state-1')
	authorize.searchParams.set('code_challenge', input.challenge)
	authorize.searchParams.set('code_challenge_method', 'S256')
	if (input.resource) authorize.searchParams.set('resource', input.resource)

	const page = await worker.fetch(
		new Request(authorize, { headers: { cookie: owner.cookie } }),
		env,
		executionContext(),
	)
	expect(page.status).toBe(200)

	const approved = await worker.fetch(
		new Request(authorize, {
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
		executionContext(),
	)
	expect(approved.status).toBe(302)
	const location = approved.headers.get('location')
	expect(location).toBeTruthy()
	const redirected = new URL(location ?? '')
	const code = redirected.searchParams.get('code')
	expect(code).toBeTruthy()
	return { owner, code: code ?? '' }
}

async function exchangeToken(
	env: ReturnType<typeof createTestEnv>,
	input: {
		clientId: string
		code?: string
		verifier?: string
		refreshToken?: string
		resource?: string
	},
) {
	const body = new URLSearchParams({ client_id: input.clientId })
	if (input.refreshToken) {
		body.set('grant_type', 'refresh_token')
		body.set('refresh_token', input.refreshToken)
	} else {
		body.set('grant_type', 'authorization_code')
		body.set('code', input.code ?? '')
		body.set('redirect_uri', 'https://kody.codes/connect/oauth')
		body.set('code_verifier', input.verifier ?? '')
	}
	if (input.resource) body.set('resource', input.resource)
	const response = await worker.fetch(
		request(oauthPaths.token, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body,
		}),
		env,
		executionContext(),
	)
	return {
		status: response.status,
		body: (await response.json()) as TokenResponse,
	}
}

async function bearerGet(
	env: ReturnType<typeof createTestEnv>,
	path: string,
	token: string,
) {
	return worker.fetch(
		request(path, { headers: { authorization: `Bearer ${token}` } }),
		env,
		executionContext(),
	)
}

test('resource-less authorize token works on /api and /mcp, and refresh stays valid', async () => {
	const origin = 'https://kody.exchange'
	const env = createTestEnv()
	const client = await registerPublicClient(env)
	const pkce = await pkcePair()
	const { owner, code } = await approveAuthorization(env, {
		clientId: client.client_id,
		challenge: pkce.challenge,
	})
	const issued = await exchangeToken(env, {
		clientId: client.client_id,
		code,
		verifier: pkce.verifier,
	})
	expect(issued.status).toBe(200)
	expect(issued.body.access_token).toBeTruthy()
	expect(issued.body.refresh_token).toBeTruthy()
	expect(issued.body.resource).toEqual(sharedProductResources(origin))
	expect(issued.body.resource).not.toBe(`${origin}/mcp`)

	const api = await bearerGet(env, '/api/me', issued.body.access_token)
	expect(api.status).toBe(200)
	const apiBody = (await api.json()) as {
		ok: boolean
		user: { id: string; login: string }
	}
	expect(apiBody.ok).toBe(true)
	expect(apiBody.user.id).toBe(owner.user.id)
	expect(apiBody.user.login).toBe(owner.user.login)

	const threads = await bearerGet(env, '/api/threads', issued.body.access_token)
	expect(threads.status).toBe(200)

	const mcp = await bearerGet(env, '/mcp', issued.body.access_token)
	expect(mcp.status).toBe(200)
	const mcpBody = (await mcp.json()) as {
		ok: boolean
		user: { login: string }
		tools: Array<string>
	}
	expect(mcpBody.ok).toBe(true)
	expect(mcpBody.user.login).toBe(owner.user.login)
	expect(mcpBody.tools).toContain('list_threads')

	const refreshResources = [undefined, origin, `${origin}/api`, `${origin}/mcp`]
	let refreshToken = issued.body.refresh_token ?? ''
	for (const resource of refreshResources) {
		const refreshed = await exchangeToken(env, {
			clientId: client.client_id,
			refreshToken,
			resource,
		})
		expect(refreshed.status).toBe(200)
		expect(refreshed.body.error).not.toBe('invalid_grant')
		expect(refreshed.body.access_token).toBeTruthy()
		expect(refreshed.body.refresh_token).toBeTruthy()
		refreshToken = refreshed.body.refresh_token ?? refreshToken
	}
})

test('explicit /mcp authorize still works for MCP and stays API-scoped', async () => {
	const origin = 'https://kody.exchange'
	const env = createTestEnv()
	const client = await registerPublicClient(env)
	const pkce = await pkcePair()
	const { code } = await approveAuthorization(env, {
		clientId: client.client_id,
		challenge: pkce.challenge,
		resource: `${origin}/mcp`,
	})
	const issued = await exchangeToken(env, {
		clientId: client.client_id,
		code,
		verifier: pkce.verifier,
		resource: `${origin}/mcp`,
	})
	expect(issued.status).toBe(200)
	expect(issued.body.resource).toBe(`${origin}/mcp`)

	const mcp = await bearerGet(env, '/mcp', issued.body.access_token)
	expect(mcp.status).toBe(200)

	const api = await bearerGet(env, '/api/me', issued.body.access_token)
	expect(api.status).toBe(401)
	const apiBody = (await api.json()) as {
		error: string
		error_description?: string
	}
	expect(apiBody.error).toBe('invalid_token')
	expect(apiBody.error_description).toContain('audience')
})
