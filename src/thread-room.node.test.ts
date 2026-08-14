import { expect, test } from 'vitest'
import { handleRequest } from '#src/index.ts'
import { ThreadRoom } from '#src/thread-room.ts'
import { createTestEnv, request } from '#src/test-support.ts'

function mockRoom() {
	const sent: Array<string> = []
	const sockets = [
		{
			send(data: string) {
				sent.push(data)
			},
		},
	]
	const ctx = {
		acceptWebSocket() {},
		getWebSockets() {
			return sockets
		},
	} as unknown as DurableObjectState
	return {
		sent,
		room: new ThreadRoom(ctx, createTestEnv()),
	}
}

test('ThreadRoom broadcasts JSON to attached sockets', async () => {
	const { room, sent } = mockRoom()
	const response = await room.fetch(
		new Request('https://thread-room/broadcast', {
			method: 'POST',
			body: '{"ok":true,"messages":[{"id":"msg_1"}]}',
		}),
	)
	expect(response.status).toBe(204)
	expect(sent).toEqual(['{"ok":true,"messages":[{"id":"msg_1"}]}'])
})

test('ThreadRoom rejects non-upgrade GET', async () => {
	const { room } = mockRoom()
	const response = await room.fetch(new Request('https://thread-room/'))
	expect(response.status).toBe(404)
})

test('sending a message broadcasts to the thread room', async () => {
	const broadcasts: Array<string> = []
	const env = createTestEnv({
		THREAD_ROOMS: {
			idFromName(name: string) {
				return { toString: () => name } as DurableObjectId
			},
			get() {
				return {
					fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
						const req =
							input instanceof Request
								? input
								: new Request(String(input), init)
						broadcasts.push(await req.text())
						return new Response(null, { status: 204 })
					},
				} as DurableObjectStub
			},
		} as unknown as DurableObjectNamespace,
	})
	const createdResponse = await handleRequest(
		request('/v1/threads', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'cf-connecting-ip': '203.0.113.77',
			},
			body: JSON.stringify({ purpose: 'live room', name: 'host' }),
		}),
		env,
	)
	const created = (await createdResponse.json()) as {
		token: string
	}
	const sent = await handleRequest(
		request('/v1/messages', {
			method: 'POST',
			headers: {
				authorization: `Bearer ${created.token}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify({ body: { text: 'hello live' } }),
		}),
		env,
	)
	expect(sent.status).toBe(200)
	expect(broadcasts).toHaveLength(1)
	expect(broadcasts[0]).toContain('hello live')
})
