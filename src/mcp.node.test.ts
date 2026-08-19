import {
	LATEST_PROTOCOL_VERSION,
	PROTOCOL_VERSION_META_KEY,
	SUPPORTED_PROTOCOL_VERSIONS,
} from '@modelcontextprotocol/server'
import { expect, test } from 'vitest'
import { handleRequest } from '#src/index.ts'
import {
	mcpLatestProtocolVersion,
	mcpLegacyProtocolVersions,
} from '#src/mcp-protocol.ts'
import {
	createSignedInUser,
	createTestEnv,
	request,
} from '#src/test-support.ts'
import worker from '#src/worker.ts'

function executionContext(): ExecutionContext {
	return {
		waitUntil() {},
		passThroughOnException() {},
		props: {},
	} as unknown as ExecutionContext
}

type RpcResult = {
	jsonrpc?: string
	id?: unknown
	result?: Record<string, unknown>
	error?: { code?: number; message?: string }
}

async function mcpRpc(
	env: ReturnType<typeof createTestEnv>,
	message: Record<string, unknown>,
	headers: HeadersInit = {},
) {
	const response = await handleRequest(
		request('/mcp', {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...headers },
			body: JSON.stringify(message),
		}),
		env,
	)
	return {
		status: response.status,
		body: (await response.json()) as RpcResult,
	}
}

test('MCP guest creates are no longer allowed without OAuth', async () => {
	const env = createTestEnv()
	const response = await handleRequest(
		request('/mcp', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'cf-connecting-ip': '203.0.113.40',
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: {
					name: 'create_thread',
					arguments: { purpose: 'guest', name: 'cursor' },
				},
			}),
		}),
		env,
	)
	expect(response.status).toBe(401)
	expect(response.headers.get('www-authenticate')).toContain(
		'resource_metadata=',
	)
	const body = (await response.json()) as {
		error: string
		signup_url: string
		hint: string
	}
	expect(body.error).toContain('free account')
	expect(body.signup_url).toBe('https://kody.exchange/auth/github')
	expect(body.hint).toContain('not a paid upgrade')
	expect(body.hint).not.toContain('Pro')
})

test('MCP browser landing sells a free GitHub account', async () => {
	const env = createTestEnv()
	const response = await handleRequest(
		request('/mcp', { headers: { accept: 'text/html' } }),
		env,
	)
	expect(response.status).toBe(200)
	const html = await response.text()
	expect(html).toContain('included with a free GitHub account')
	expect(html).toContain('/auth/github')
	expect(html).not.toContain('Pro')
})

test('OAuth MCP create_thread opens an account-owned thread', async () => {
	const env = createTestEnv()
	const owner = await createSignedInUser(env)
	env.OAUTH_USER = owner.user
	const response = await handleRequest(
		request('/mcp', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: {
					name: 'create_thread',
					arguments: { purpose: 'from mcp', name: 'cursor' },
				},
			}),
		}),
		env,
	)
	expect(response.status).toBe(200)
	const rpc = (await response.json()) as {
		result: { content: Array<{ text: string }> }
	}
	const payload = JSON.parse(rpc.result.content[0]?.text ?? '{}') as {
		ok: boolean
		thread: { id: string }
		plan: string
	}
	expect(payload.ok).toBe(true)
	expect(payload.plan).toBe('free')
	expect(payload.thread.id).toMatch(/^th_/)
})

test('advertised protocol versions match the MCP server SDK plus 2026-07-28', () => {
	expect(mcpLatestProtocolVersion).toBe('2026-07-28')
	expect([...mcpLegacyProtocolVersions]).toEqual([
		...SUPPORTED_PROTOCOL_VERSIONS,
	])
	expect(LATEST_PROTOCOL_VERSION).toBe('2025-11-25')
})

test('legacy initialize negotiates a 2025-era protocol version', async () => {
	const env = createTestEnv()
	const owner = await createSignedInUser(env)
	env.OAUTH_USER = owner.user
	const { status, body } = await mcpRpc(env, {
		jsonrpc: '2.0',
		id: 1,
		method: 'initialize',
		params: {
			protocolVersion: '2025-03-26',
			capabilities: {},
			clientInfo: { name: 'test', version: '1' },
		},
	})
	expect(status).toBe(200)
	expect(body.error).toBeUndefined()
	expect(body.result?.protocolVersion).toBe('2025-03-26')
	expect(body.result?.serverInfo).toMatchObject({ name: 'kody.exchange' })
})

test('modern server/discover answers 2026-07-28', async () => {
	const env = createTestEnv()
	const owner = await createSignedInUser(env)
	env.OAUTH_USER = owner.user
	const { status, body } = await mcpRpc(
		env,
		{
			jsonrpc: '2.0',
			id: 1,
			method: 'server/discover',
			params: {
				_meta: {
					[PROTOCOL_VERSION_META_KEY]: mcpLatestProtocolVersion,
					'io.modelcontextprotocol/clientCapabilities': {},
					'io.modelcontextprotocol/clientInfo': {
						name: 'test',
						version: '1',
					},
				},
			},
		},
		{
			'mcp-protocol-version': mcpLatestProtocolVersion,
			'mcp-method': 'server/discover',
		},
	)
	if (status !== 200) {
		throw new Error(`discover failed ${status}: ${JSON.stringify(body)}`)
	}
	expect(body.error).toBeUndefined()
	const versions = body.result?.supportedVersions
	expect(Array.isArray(versions) ? versions : []).toContain(
		mcpLatestProtocolVersion,
	)
})

test('MCP rejects opaque and malformed Origins', async () => {
	const env = createTestEnv()
	const owner = await createSignedInUser(env)
	env.OAUTH_USER = owner.user
	const initialize = {
		jsonrpc: '2.0',
		id: 1,
		method: 'initialize',
		params: {
			protocolVersion: '2025-03-26',
			capabilities: {},
			clientInfo: { name: 'test', version: '1' },
		},
	}

	const opaque = await mcpRpc(env, initialize, { origin: 'null' })
	expect(opaque.status).toBe(403)
	expect((opaque.body as unknown as { code: string }).code).toBe('bad_origin')

	const malformed = await handleRequest(
		request('/mcp', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				origin: 'not a url',
			},
			body: JSON.stringify(initialize),
		}),
		env,
	)
	expect(malformed.status).toBe(403)
	expect(((await malformed.json()) as { code: string }).code).toBe('bad_origin')

	const fileOrigin = await mcpRpc(env, initialize, { origin: 'file://' })
	expect(fileOrigin.status).toBe(403)

	const allowed = await mcpRpc(env, initialize, {
		origin: 'https://claude.ai',
	})
	expect(allowed.status).toBe(200)
	expect(allowed.body.result?.protocolVersion).toBe('2025-03-26')
})

test('worker rejects opaque Origin before OAuth', async () => {
	const env = createTestEnv()
	const response = await worker.fetch(
		request('/mcp', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				origin: 'null',
			},
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
		}),
		env,
		executionContext(),
	)
	expect(response.status).toBe(403)
	const body = (await response.json()) as { code: string }
	expect(body.code).toBe('bad_origin')
})

test('worker OAuthProvider challenges unauthenticated MCP POSTs', async () => {
	const env = createTestEnv()
	const response = await worker.fetch(
		request('/mcp', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
		}),
		env,
		executionContext(),
	)
	expect(response.status).toBe(401)
	expect(response.headers.get('www-authenticate') ?? '').toMatch(
		/resource_metadata=/,
	)
})
