import { expect, test } from 'vitest'
import { handleRequest } from '#src/index.ts'
import { createTestEnv, request } from '#src/test-support.ts'

function mcpCreate(ip: string, purpose: string) {
	return request('/mcp', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'cf-connecting-ip': ip,
		},
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/call',
			params: {
				name: 'create_thread',
				arguments: { purpose, name: 'cursor' },
			},
		}),
	})
}

type McpToolRpc = {
	result?: { content?: Array<{ text?: string }> }
}

function toolPayload(rpc: McpToolRpc) {
	const text = rpc.result?.content?.[0]?.text
	if (!text) throw new Error('MCP tool result had no text')
	return JSON.parse(text) as { ok?: boolean; code?: string }
}

test('MCP guest creates honor the caller IP', async () => {
	const env = createTestEnv()
	const first = await handleRequest(mcpCreate('203.0.113.40', 'one'), env)
	expect(first.status).toBe(200)
	expect(toolPayload(await first.json())).toMatchObject({ ok: true })

	const sameIp = await handleRequest(mcpCreate('203.0.113.40', 'two'), env)
	expect(toolPayload(await sameIp.json())).toMatchObject({
		code: 'guest_thread_limit',
	})

	const otherIp = await handleRequest(mcpCreate('198.51.100.40', 'three'), env)
	expect(toolPayload(await otherIp.json())).toMatchObject({ ok: true })
})
