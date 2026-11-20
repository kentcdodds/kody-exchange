import { expect, test } from 'vitest'
import { handleRequest } from '#src/index.ts'
import {
	createSignedInUser,
	createTestEnv,
	request,
} from '#src/test-support.ts'
import { type AppEnv } from '#src/env.ts'

type JoinBody = {
	ok: boolean
	code?: string
	token: string
	agent: { id: string; name: string }
	rejoined: boolean
}

async function call(env: AppEnv, path: string, init: RequestInit = {}) {
	const response = await handleRequest(request(path, init), env)
	return {
		status: response.status,
		body: (await response.json()) as Record<string, unknown>,
	}
}

async function guestRoom(env: AppEnv, ip: string) {
	const created = await call(env, '/v1/threads', {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
		body: JSON.stringify({ purpose: 'pair', name: 'host' }),
	})
	expect(created.status).toBe(200)
	return created.body as { token: string; join_token: string }
}

async function join(
	env: AppEnv,
	joinToken: string,
	name: unknown,
	liveToken?: string,
) {
	const response = await call(env, '/v1/join', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...(liveToken ? { authorization: `Bearer ${liveToken}` } : {}),
		},
		body: JSON.stringify({ join_token: joinToken, name }),
	})
	return { status: response.status, body: response.body as JoinBody }
}

function rename(env: AppEnv, token: string, name: unknown) {
	return call(env, '/v1/name', {
		method: 'PUT',
		headers: {
			authorization: `Bearer ${token}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify({ name }),
	})
}

function leave(env: AppEnv, token: string) {
	return call(env, '/v1/leave', {
		method: 'POST',
		headers: { authorization: `Bearer ${token}` },
	})
}

async function texts(env: AppEnv, token: string) {
	const polled = await call(env, '/v1/messages?after=0', {
		headers: { authorization: `Bearer ${token}` },
	})
	const messages = polled.body.messages as Array<{
		kind: string
		from: { name: string }
		body: { text: string }
	}>
	return messages.map((message) => `${message.from.name}: ${message.body.text}`)
}

test('a rejoin without the live token still takes a new spot until spots run out', async () => {
	const env = createTestEnv()
	const room = await guestRoom(env, '203.0.113.81')
	const first = await join(env, room.join_token, 'wrong-name')
	expect(first.status).toBe(200)
	const again = await join(env, room.join_token, 'right-name')
	expect(again.status).toBe(402)
	expect(again.body.code).toBe('participant_limit')
	expect(again.body).toMatchObject({
		error: expect.stringContaining('POST /v1/leave'),
	})
})

test('rejoining with the live token reuses the same spot and applies the new name', async () => {
	const env = createTestEnv()
	const room = await guestRoom(env, '203.0.113.82')
	const first = await join(env, room.join_token, 'wrong-name')
	expect(first.body.rejoined).toBe(false)
	for (let i = 0; i < 3; i++) {
		const again = await join(
			env,
			room.join_token,
			'right-name',
			first.body.token,
		)
		expect(again.status).toBe(200)
		expect(again.body.rejoined).toBe(true)
		expect(again.body.agent).toEqual({
			id: first.body.agent.id,
			name: 'right-name',
		})
		expect(again.body.token).toBe(first.body.token)
	}
	expect(await texts(env, room.token)).toEqual([
		'host: host joined.',
		'right-name: wrong-name joined.',
		'right-name: wrong-name is now right-name.',
	])
})

test('a live token from another thread does not reuse a spot here', async () => {
	const env = createTestEnv()
	const roomA = await guestRoom(env, '203.0.113.83')
	const roomB = await guestRoom(env, '203.0.113.84')
	const inA = await join(env, roomA.join_token, 'agent')
	const inB = await join(env, roomB.join_token, 'agent', inA.body.token)
	expect(inB.status).toBe(200)
	expect(inB.body.rejoined).toBe(false)
	expect(inB.body.agent.id).not.toBe(inA.body.agent.id)
})

test('a participant renames itself with the same validation as join', async () => {
	const env = createTestEnv()
	const room = await guestRoom(env, '203.0.113.85')
	const joined = await join(env, room.join_token, 'wrong-name')
	const renamed = await rename(env, joined.body.token, '  right-name  ')
	expect(renamed.status).toBe(200)
	expect(renamed.body.agent).toEqual({
		id: joined.body.agent.id,
		name: 'right-name',
	})

	const long = 'n'.repeat(80)
	const truncated = await rename(env, joined.body.token, long)
	expect(truncated.body.agent).toMatchObject({ name: 'n'.repeat(64) })

	for (const bad of ['   ', '', 42, null]) {
		const rejected = await rename(env, joined.body.token, bad)
		expect(rejected.status).toBe(400)
		expect(rejected.body.code).toBe('bad_name')
	}
	const same = await rename(env, joined.body.token, 'n'.repeat(64))
	expect(same.status).toBe(200)

	const hostRenamed = await rename(env, room.token, 'cursor')
	expect(hostRenamed.status).toBe(200)

	expect(await texts(env, room.token)).toEqual([
		'cursor: host joined.',
		'nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn: wrong-name joined.',
		'nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn: wrong-name is now right-name.',
		`nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn: right-name is now ${'n'.repeat(64)}.`,
		'cursor: host is now cursor.',
	])
	expect(await call(env, '/v1/name', { method: 'PUT' })).toMatchObject({
		status: 401,
	})
})

test('leaving frees the spot, ends the token, and the host stays', async () => {
	const env = createTestEnv()
	const room = await guestRoom(env, '203.0.113.86')
	const wrong = await join(env, room.join_token, 'wrong-name')
	expect((await join(env, room.join_token, 'right-name')).status).toBe(402)

	const hostLeave = await leave(env, room.token)
	expect(hostLeave.status).toBe(403)
	expect(hostLeave.body.code).toBe('host_cannot_leave')

	const left = await leave(env, wrong.body.token)
	expect(left).toEqual({ status: 200, body: { ok: true, left: true } })
	expect((await leave(env, wrong.body.token)).status).toBe(401)
	expect(
		(
			await call(env, '/v1/messages?after=0', {
				headers: { authorization: `Bearer ${wrong.body.token}` },
			})
		).status,
	).toBe(401)
	const rejoinWithEndedToken = await join(
		env,
		room.join_token,
		'right-name',
		wrong.body.token,
	)
	expect(rejoinWithEndedToken.status).toBe(200)
	expect(rejoinWithEndedToken.body.rejoined).toBe(false)
	expect(rejoinWithEndedToken.body.agent.id).not.toBe(wrong.body.agent.id)

	expect(await texts(env, room.token)).toEqual([
		'host: host joined.',
		'wrong-name: wrong-name joined.',
		'wrong-name: wrong-name left.',
		'right-name: right-name joined.',
	])
})

test('rename and leave are closed on an archived thread', async () => {
	const env = createTestEnv()
	const room = await guestRoom(env, '203.0.113.88')
	const guest = await join(env, room.join_token, 'guest')
	const archived = await call(env, '/v1/archive', {
		method: 'POST',
		headers: { authorization: `Bearer ${room.token}` },
	})
	expect(archived.status).toBe(200)
	const renamed = await rename(env, guest.body.token, 'other')
	expect(renamed.status).toBe(409)
	expect(renamed.body.code).toBe('thread_archived')
	const left = await leave(env, guest.body.token)
	expect(left.status).toBe(409)
	expect(left.body.code).toBe('thread_archived')
})

async function mcpTool(
	env: AppEnv,
	name: string,
	args: Record<string, unknown>,
) {
	const response = await handleRequest(
		request('/mcp', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: { name, arguments: args },
			}),
		}),
		env,
	)
	const rpc = (await response.json()) as {
		result: { content: Array<{ text: string }> }
	}
	return JSON.parse(rpc.result.content[0]?.text ?? '{}') as Record<
		string,
		unknown
	>
}

test('MCP agents rejoin with their token, rename, and leave', async () => {
	const env = createTestEnv()
	const owner = await createSignedInUser(env)
	env.OAUTH_USER = owner.user
	const room = await guestRoom(env, '203.0.113.89')

	const joined = (await mcpTool(env, 'join_thread', {
		join_token: room.join_token,
		name: 'wrong-name',
	})) as unknown as JoinBody
	expect(joined.ok).toBe(true)
	const rejoined = (await mcpTool(env, 'join_thread', {
		join_token: room.join_token,
		name: 'better-name',
		token: joined.token,
	})) as unknown as JoinBody
	expect(rejoined).toMatchObject({
		ok: true,
		rejoined: true,
		agent: { id: joined.agent.id, name: 'better-name' },
	})

	const renamed = await mcpTool(env, 'rename_agent', {
		token: joined.token,
		name: 'right-name',
	})
	expect(renamed).toEqual({
		ok: true,
		agent: { id: joined.agent.id, name: 'right-name' },
	})
	const left = await mcpTool(env, 'leave_thread', { token: joined.token })
	expect(left).toEqual({ ok: true, left: true })

	const next = await join(env, room.join_token, 'next')
	expect(next.status).toBe(200)
})

test('a participant that leaves stops receiving webhook deliveries', async () => {
	const env = createTestEnv()
	const room = await guestRoom(env, '203.0.113.90')
	const guest = await join(env, room.join_token, 'guest')
	const hooked = await call(env, '/v1/webhook', {
		method: 'PUT',
		headers: {
			authorization: `Bearer ${guest.body.token}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify({ url: 'https://hooks.example.test/guest' }),
	})
	expect(hooked.status).toBe(200)
	expect((await leave(env, guest.body.token)).status).toBe(200)
	const thread = await env.DB.prepare(
		'SELECT t.webhook_url FROM threads t JOIN agents a ON a.thread_id = t.id WHERE a.id = ?',
	)
		.bind(guest.body.agent.id)
		.first<{ webhook_url: string | null }>()
	expect(thread).toEqual({ webhook_url: null })
})
