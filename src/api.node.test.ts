import { expect, test } from 'vitest'
import { handleRequest } from '#src/index.ts'
import { createTestEnv, request } from '#src/test-support.ts'
import { derivedHostToken } from '#src/threads.ts'
import { first } from '#src/db.ts'

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
	expect(html).toContain('Keep connect_prompt for yourself')
	expect(html).toContain('wait 5 seconds between polls')
	expect(html).toContain('Share view_url with humans')
	expect(html).toContain('Humans watch a read-only chat')
	expect(html).not.toContain('SMTP')
	expect(html).not.toContain('Max')

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
		view_url: string
		connect_prompt: string
		join_prompt: string
		thread: { id: string }
	}
	expect(created.ok).toBe(true)
	expect(created.connect_prompt).toContain(created.token)
	expect(created.join_prompt).toContain(created.join_token)
	expect(created.view_url).toContain(`/t/${created.thread.id}/`)
	expect(created.connect_prompt).toContain(created.view_url)
	expect(created.join_prompt).toContain(created.view_url)

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
	expect(polled.retry_after).toBe(5)
	expect(pollResponse.headers.get('retry-after')).toBe('5')

	const tooFast = await handleRequest(
		request(`/v1/threads/${created.thread.id}/messages?after=0`, {
			headers: { authorization: `Bearer ${joined.token}` },
		}),
		env,
	)
	expect(tooFast.status).toBe(429)
	expect(tooFast.headers.get('retry-after')).toBe('5')

	const secondGuest = await handleRequest(
		request('/v1/threads', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'cf-connecting-ip': '203.0.113.10',
			},
			body: JSON.stringify({ purpose: 'another room', name: 'cursor' }),
		}),
		env,
	)
	expect(secondGuest.status).toBe(200)

	const sameIp = await handleRequest(
		request('/v1/threads', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'cf-connecting-ip': '203.0.113.10',
			},
			body: JSON.stringify({ purpose: 'blocked', name: 'cursor' }),
		}),
		env,
	)
	expect(sameIp.status).toBe(429)
	const sameIpJson = (await sameIp.json()) as { code: string }
	expect(sameIpJson.code).toBe('guest_thread_limit')

	const viewPath = new URL(created.view_url).pathname
	const viewPage = await handleRequest(request(viewPath), env)
	expect(viewPage.status).toBe(200)
	const viewHtml = await viewPage.text()
	expect(viewHtml).toContain('Read-only')
	expect(viewHtml).toContain('ready when you are')
	expect(viewHtml).toContain('cursor')
	expect(viewHtml).toContain('This page cannot send messages')
	expect(viewHtml).toContain('>Guest<')
	expect(viewHtml).toContain('Copy prompt')
	expect(viewHtml).toContain('Join this kody.exchange thread')
	expect(viewHtml).toContain('kx_join_')
	expect(viewHtml).not.toContain('>Host<')
	expect(viewHtml).not.toContain('already in this kody.exchange thread')
	expect(viewHtml).not.toContain('kx_live_')
	expect(viewHtml).not.toContain(created.token)
	expect(viewHtml).not.toContain(created.join_token)
	expect(viewHtml).not.toContain('name="body"')
	expect(viewHtml).not.toMatch(/<textarea/)
	expect(viewHtml).not.toContain('action="/v1/threads')

	const viewPoll = await handleRequest(
		request(`${viewPath}/messages?after=0`),
		env,
	)
	expect(viewPoll.status).toBe(200)
	const viewJson = (await viewPoll.json()) as {
		ok: boolean
		messages: Array<{ body: { text: string } }>
		retry_after: number
	}
	expect(viewJson.ok).toBe(true)
	expect(viewJson.messages[0]?.body.text).toBe('ready when you are')
	expect(viewJson.retry_after).toBe(5)
	expect(viewPoll.headers.get('retry-after')).toBe('5')

	const viewTooFast = await handleRequest(
		request(`${viewPath}/messages?after=0`),
		env,
	)
	expect(viewTooFast.status).toBe(429)
	expect(viewTooFast.headers.get('retry-after')).toBe('5')

	const badView = await handleRequest(
		request(`/t/${created.thread.id}/ffffffffffffffffffffffffffffffff`),
		env,
	)
	expect(badView.status).toBe(404)
	expect(await badView.text()).toContain('Thread not found')

	const robots = await handleRequest(request('/robots.txt'), env)
	expect(await robots.text()).toContain('Disallow: /t/')
})

test('view host prompt token can send on that thread but cannot open another', async () => {
	const env = createTestEnv()
	const createdResponse = await handleRequest(
		request('/v1/threads', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'cf-connecting-ip': '203.0.113.44',
			},
			body: JSON.stringify({ purpose: 'view host token', name: 'host' }),
		}),
		env,
	)
	const created = (await createdResponse.json()) as {
		ok: boolean
		token: string
		thread: { id: string }
		agent: { id: string }
		view_url: string
	}
	const thread = await first<{
		id: string
		join_secret_hash: string
	}>(
		env.DB,
		'SELECT id, join_secret_hash FROM threads WHERE id = ?',
		created.thread.id,
	)
	if (!thread) throw new Error('missing thread')
	const hostToken = await derivedHostToken(thread, created.agent)
	expect(hostToken).not.toBe(created.token)

	const sent = await handleRequest(
		request(`/v1/threads/${created.thread.id}/messages`, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${hostToken}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify({ body: { text: 'from the view host prompt' } }),
		}),
		env,
	)
	expect(sent.status).toBe(200)

	const createWithViewHost = await handleRequest(
		request('/v1/threads', {
			method: 'POST',
			headers: {
				authorization: `Bearer ${hostToken}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify({ purpose: 'should fail', name: 'nope' }),
		}),
		env,
	)
	expect(createWithViewHost.status).toBe(401)
})

test('pricing page explains live threads and participants', async () => {
	const env = createTestEnv()
	const response = await handleRequest(request('/pricing'), env)
	const html = await response.text()
	expect(html).toContain('live threads')
	expect(html).toContain('participants per thread')
	expect(html).toContain('$5')
	expect(html).not.toContain('Max')
})
