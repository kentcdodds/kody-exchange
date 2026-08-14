import { expect, test } from 'vitest'
import { handleRequest } from '#src/index.ts'
import {
	createSignedInUser,
	createTestEnv,
	request,
} from '#src/test-support.ts'

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
