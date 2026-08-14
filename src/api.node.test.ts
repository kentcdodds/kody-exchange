import { expect, test } from 'vitest'
import { handleRequest } from '#src/index.ts'
import { createTestEnv, request } from '#src/test-support.ts'

test('guest thread: create, join, send, poll, and health', async () => {
	const env = createTestEnv()
	const health = await handleRequest(request('/health'), env)
	expect(health.status).toBe(200)
	const healthJson = (await health.json()) as { ok: boolean; commit: string }
	expect(healthJson).toEqual({
		ok: true,
		commit: 'testsha',
		githubOAuth: false,
		stripe: false,
	})

	const home = await handleRequest(request('/'), env)
	expect(home.status).toBe(200)
	const html = await home.text()
	expect(html).toContain('A spot for two or more agents')
	expect(html).toContain('For agents')
	expect(html).toContain('POST https://kody.exchange/v1/threads')
	expect(html).not.toContain('SMTP')

	const createdResponse = await handleRequest(
		request('/v1/threads', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ purpose: 'ship kody.exchange', name: 'cursor' }),
		}),
		env,
	)
	expect(createdResponse.status).toBe(200)
	const created = (await createdResponse.json()) as {
		ok: boolean
		token: string
		join_token: string
		join_prompt: string
		thread: { id: string }
	}
	expect(created.ok).toBe(true)
	expect(created.join_prompt).toContain(created.join_token)

	const joinResponse = await handleRequest(
		request(`/v1/threads/${created.thread.id}/join`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ join_token: created.join_token, name: 'claude' }),
		}),
		env,
	)
	const joined = (await joinResponse.json()) as { ok: boolean; token: string }
	expect(joinResponse.status).toBe(200)
	expect(joined.ok).toBe(true)

	const sendResponse = await handleRequest(
		request(`/v1/threads/${created.thread.id}/messages`, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${created.token}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify({ body: { text: 'ready when you are' } }),
		}),
		env,
	)
	const sent = (await sendResponse.json()) as {
		ok: boolean
		message: { id: string; body: { text: string } }
	}
	expect(sendResponse.status).toBe(200)
	expect(sent.message.body.text).toBe('ready when you are')

	const pollResponse = await handleRequest(
		request(`/v1/threads/${created.thread.id}/messages?after=0`, {
			headers: { authorization: `Bearer ${joined.token}` },
		}),
		env,
	)
	const polled = (await pollResponse.json()) as {
		ok: boolean
		messages: Array<{ id: string }>
		retry_after: number
	}
	expect(pollResponse.status).toBe(200)
	expect(polled.messages.map((message) => message.id)).toEqual([
		sent.message.id,
	])
	expect(polled.retry_after).toBe(2)
	expect(pollResponse.headers.get('retry-after')).toBe('2')

	const tooFast = await handleRequest(
		request(`/v1/threads/${created.thread.id}/messages?after=0`, {
			headers: { authorization: `Bearer ${joined.token}` },
		}),
		env,
	)
	expect(tooFast.status).toBe(429)
	expect(tooFast.headers.get('retry-after')).toBe('1')
})

test('pricing page explains live agent tokens', async () => {
	const env = createTestEnv()
	const response = await handleRequest(request('/pricing'), env)
	const html = await response.text()
	expect(html).toContain('live tokens on the account')
	expect(html).toContain('$12')
})
