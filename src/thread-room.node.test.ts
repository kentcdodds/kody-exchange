import { expect, test } from 'vitest'
import { first, run } from '#src/db.ts'
import { handleRequest } from '#src/index.ts'
import { yearMonth } from '#src/limits.ts'
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
	expect(broadcasts).toHaveLength(2)
	expect(broadcasts[0]).toContain('host joined.')
	expect(broadcasts[0]).toContain('"members"')
	expect(broadcasts[1]).toContain('hello live')
})

test('join still broadcasts the roster when the join notice cannot post', async () => {
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
				'cf-connecting-ip': '203.0.113.79',
			},
			body: JSON.stringify({ purpose: 'full cap', name: 'host' }),
		}),
		env,
	)
	const created = (await createdResponse.json()) as {
		ok: boolean
		join_token: string
		thread: { created_at: string }
	}
	expect(created.ok).toBe(true)
	const thread = await first<{ id: string }>(env.DB, 'SELECT id FROM threads')
	if (!thread) throw new Error('thread missing')
	await run(
		env.DB,
		`INSERT INTO usage_months (owner_key, yyyymm, message_count)
		 VALUES (?, ?, 50)
		 ON CONFLICT (owner_key, yyyymm) DO UPDATE SET message_count = 50`,
		`guest:${thread.id}`,
		yearMonth(Date.parse(created.thread.created_at)),
	)
	const joined = await handleRequest(
		request('/v1/join', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				join_token: created.join_token,
				name: 'guest',
			}),
		}),
		env,
	)
	expect(joined.status).toBe(200)
	const last = broadcasts.at(-1)
	expect(last).toContain('"messages":[]')
	expect(last).toContain('"name":"guest"')
	expect(last).toContain('"name":"host"')
})

test('a room broadcast failure does not fail the send', async () => {
	const env = createTestEnv({
		THREAD_ROOMS: {
			idFromName(name: string) {
				return { toString: () => name } as DurableObjectId
			},
			get() {
				return {
					fetch: async () => {
						throw new Error('room down')
					},
				} as unknown as DurableObjectStub
			},
		} as unknown as DurableObjectNamespace,
	})
	const createdResponse = await handleRequest(
		request('/v1/threads', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'cf-connecting-ip': '203.0.113.78',
			},
			body: JSON.stringify({ purpose: 'room down', name: 'host' }),
		}),
		env,
	)
	const created = (await createdResponse.json()) as { token: string }
	const sent = await handleRequest(
		request('/v1/messages', {
			method: 'POST',
			headers: {
				authorization: `Bearer ${created.token}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify({ body: { text: 'still persisted' } }),
		}),
		env,
	)
	expect(sent.status).toBe(200)
	const body = (await sent.json()) as {
		ok: boolean
		message: { body: { text: string } }
	}
	expect(body.ok).toBe(true)
	expect(body.message.body.text).toBe('still persisted')
})
