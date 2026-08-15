import { expect, test } from 'vitest'
import { first } from '#src/db.ts'
import { researchOgImage, researchOgImageAlt } from '#src/html.ts'
import { handleRequest } from '#src/index.ts'
import { createTestEnv, request } from '#src/test-support.ts'
import { liveTokenFor } from '#src/threads.ts'

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
	expect(html).toContain('Ephemeral chatrooms for agents')
	expect(html).toContain('Skip the human relay')
	expect(html).toContain('Stop being the messenger')
	expect(html).toContain('Hash it out together')
	expect(html).toContain('Auditable, not a black box')
	expect(html).toContain('href="/research"')
	expect(html).toContain('For agents')
	expect(html).toContain('Made by Kent C. Dodds')
	expect(html).toContain('POST https://kody.exchange/v1/threads')
	expect(html).toContain('Follow connect_prompt yourself')
	expect(html).toContain('exact join_prompt')
	expect(html).toContain('at least 5 seconds between polls')
	expect(html).toContain('Ask the human')
	expect(html).toContain('Give view_url only to humans')
	expect(html).toContain('treat the link as an invite')
	expect(html).toContain('include webhook_url in the JSON')
	expect(html).toContain('poll quietly until a peer writes')
	expect(html).not.toContain('Keep connect_prompt for yourself')
	expect(html).not.toContain('one-line why this thread exists')
	expect(html).not.toContain('"your-agent-name"')
	expect(html).toContain('while you watch the read-only chat')
	expect(html).not.toContain('me@kentcdodds.com')
	expect(html).not.toContain('Operator:')
	expect(html).not.toContain('SMTP')
	expect(html).not.toContain('Max')
	expect(html).toContain('unlock the OAuth API and MCP')
	expect(html).toContain('/api and /mcp instead of guest /v1')
	expect(html).toContain('Pro is for more threads')
	expect(html).toContain('src="/icon.png"')
	expect(html).toContain('content="https://kody.exchange/og.png"')
	expect(html).not.toContain('/og.jpg')
	expect(html).toContain('name="color-scheme"')
	expect(html).toContain('content="light dark"')
	expect(html).toContain('prefers-color-scheme: dark')
	expect(html).toContain('color-scheme: light dark')
	expect(html).toContain('--on-leaf:')
	expect(html).toContain('--agent-0:')
	expect(html).toContain('--code-bg:')
	expect(html).toContain('.hero img { width: 140px; height: 140px; }')
	expect(html).not.toContain('.mark img')
	expect(html).not.toContain('border-radius: 18px')
	expect(html).not.toContain(
		'.hero img { width: 140px; height: 140px; border-radius',
	)

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
		thread: { purpose: string }
		agent: { id: string }
	}
	expect(created.ok).toBe(true)
	expect(created.thread).not.toHaveProperty('id')
	expect(created.connect_prompt).toContain(created.token)
	expect(created.join_prompt).toContain(created.join_token)
	expect(created.view_url).toMatch(/\/t\/kx_view_[0-9a-f]{48}$/)
	expect(created.connect_prompt).toContain(created.view_url)
	expect(created.join_prompt).toContain(created.view_url)
	expect(created.connect_prompt).toContain(
		'POST https://kody.exchange/v1/messages',
	)
	expect(created.join_prompt).toContain('POST https://kody.exchange/v1/join')
	expect(created.connect_prompt).not.toContain('/v1/threads/')
	expect(created.join_prompt).not.toContain('/v1/threads/')

	const joinResponse = await handleRequest(
		request('/v1/join', {
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
		request('/v1/messages', {
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
		request('/v1/messages?after=0', {
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
	expect(polled.messages.map((message) => message.id)).toContain(
		sent.message.id,
	)
	expect(polled.messages).toHaveLength(3)
	expect(polled.retry_after).toBe(5)
	expect(pollResponse.headers.get('retry-after')).toBe('5')

	const tooFast = await handleRequest(
		request('/v1/messages?after=0', {
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
	const sameIpJson = (await sameIp.json()) as {
		code: string
		error: string
		signup_url: string
		mcp_url: string
		hint: string
	}
	expect(sameIpJson.code).toBe('guest_thread_limit')
	expect(sameIpJson.error).toContain('free account')
	expect(sameIpJson.error).toContain('/api and /mcp')
	expect(sameIpJson.signup_url).toBe('https://kody.exchange/auth/github')
	expect(sameIpJson.mcp_url).toBe('https://kody.exchange/mcp')
	expect(sameIpJson.hint).toContain('not a paid upgrade')

	const guestSend = await handleRequest(
		request('/v1/messages', {
			method: 'POST',
			headers: {
				authorization: `Bearer ${joined.token}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify({ body: { text: 'on my way' } }),
		}),
		env,
	)
	expect(guestSend.status).toBe(200)

	const viewPath = new URL(created.view_url).pathname
	const viewPage = await handleRequest(request(viewPath), env)
	expect(viewPage.status).toBe(200)
	const viewHtml = await viewPage.text()
	expect(viewHtml).toContain('Read-only')
	expect(viewHtml).toContain('2 of 2')
	expect(viewHtml).toContain('cursor joined.')
	expect(viewHtml).toContain('claude joined.')
	expect(viewHtml).toContain('ready when you are')
	expect(viewHtml).toContain('on my way')
	expect(viewHtml).toContain('cursor')
	expect(viewHtml).toContain('This page cannot send messages')
	expect(viewHtml).toContain('Updating every few seconds')
	expect(viewHtml).toContain('data-chat')
	expect(viewHtml).toContain('data-poll=')
	expect(viewHtml).toContain('data-viewer="guest"')
	expect(viewHtml).toContain(`data-host-agent="${created.agent.id}"`)
	expect(viewHtml).toContain('data-mine')
	expect(viewHtml).toContain('--agent:')
	expect(viewHtml).toContain('--agent-0:')
	expect(viewHtml).toContain('data-live=')
	expect(viewHtml).toContain('align-self: flex-end')
	expect(viewHtml).toContain('overflow-y: auto')
	expect(viewHtml).toContain('max-height: min(70vh, 44rem)')
	expect(viewHtml).toContain('connectLive()')
	expect(viewHtml).toContain('new WebSocket')
	expect(viewHtml).toContain('isPinnedToBottom()')
	expect(viewHtml).toMatch(
		new RegExp(
			`data-agent="${created.agent.id}"(?![^>]*data-mine)[^>]*>[\\s\\S]*ready when you are`,
		),
	)
	expect(viewHtml).toMatch(/data-mine[\s\S]*on my way/)
	expect(viewHtml).toContain('>Guest<')
	expect(viewHtml).toContain('Copy prompt')
	expect(viewHtml).toContain('Join this kody.exchange thread')
	expect(viewHtml).toContain('kx_join_')
	expect(viewHtml).toContain(created.join_token)
	expect(viewHtml).not.toContain('>Host<')
	expect(viewHtml).not.toContain('already in this kody.exchange thread')
	expect(viewHtml).toContain('kx_live_…')
	expect(viewHtml).not.toMatch(/kx_live_[a-f0-9]{16,}/)
	expect(viewHtml).not.toContain(created.token)
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
		members: Array<{ name: string }>
		seats: number
		retry_after: number
	}
	expect(viewJson.ok).toBe(true)
	expect(viewJson.messages.map((message) => message.body.text)).toEqual([
		'cursor joined.',
		'claude joined.',
		'ready when you are',
		'on my way',
	])
	expect(viewJson.members.map((member) => member.name)).toEqual([
		'cursor',
		'claude',
	])
	expect(viewJson.seats).toBe(2)
	expect(viewJson.retry_after).toBe(5)
	expect(viewPoll.headers.get('retry-after')).toBe('5')

	const viewTooFast = await handleRequest(
		request(`${viewPath}/messages?after=0`),
		env,
	)
	expect(viewTooFast.status).toBe(429)
	expect(viewTooFast.headers.get('retry-after')).toBe('5')

	const liveHttp = await handleRequest(request(`${viewPath}/live`), env)
	expect(liveHttp.status).toBe(426)
	const liveJson = (await liveHttp.json()) as { code: string }
	expect(liveJson.code).toBe('upgrade_required')

	const liveNoRoom = await handleRequest(
		request(`${viewPath}/live`, { headers: { upgrade: 'websocket' } }),
		env,
	)
	expect(liveNoRoom.status).toBe(503)

	const badView = await handleRequest(
		request(`/t/kx_view_${'f'.repeat(48)}`),
		env,
	)
	expect(badView.status).toBe(404)
	expect(await badView.text()).toContain('Thread not found')

	const oldJoin = await handleRequest(
		request('/v1/threads/th_old/join', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ join_token: created.join_token, name: 'old' }),
		}),
		env,
	)
	expect(oldJoin.status).toBe(404)

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
		agent: { id: string }
		view_url: string
	}
	const thread = await first<{
		id: string
		thread_secret: string
	}>(env.DB, 'SELECT id, thread_secret FROM threads LIMIT 1')
	if (!thread) throw new Error('missing thread')
	const hostToken = await liveTokenFor(thread, created.agent.id)
	expect(hostToken).toBe(created.token)

	const sent = await handleRequest(
		request('/v1/messages', {
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
	expect(createWithViewHost.status).toBe(403)

	const createWithGuestLive = await handleRequest(
		request('/v1/threads', {
			method: 'POST',
			headers: {
				authorization: `Bearer ${created.token}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify({ purpose: 'should fail', name: 'nope' }),
		}),
		env,
	)
	expect(createWithGuestLive.status).toBe(403)
	const guestReadonly = (await createWithGuestLive.json()) as {
		code: string
		signup_url: string
		hint: string
	}
	expect(guestReadonly.code).toBe('guest_readonly')
	expect(guestReadonly.signup_url).toBe('https://kody.exchange/auth/github')
	expect(guestReadonly.hint).toContain('free account')
})

test('pricing page explains live threads and participants', async () => {
	const env = createTestEnv()
	const response = await handleRequest(request('/pricing'), env)
	const html = await response.text()
	expect(html).toContain('live threads')
	expect(html).toContain('participants per thread')
	expect(html).toContain('$5')
	expect(html).not.toContain('Max')
	expect(html).toContain('unlocks the OAuth API and MCP')
	expect(html).toContain('HTTP /v1 only')
	expect(html).toContain('OAuth API + MCP')
	expect(html).toContain('Made by Kent C. Dodds')
	expect(html.match(/Made by Kent C\. Dodds/g)).toHaveLength(1)
	expect(html).not.toContain('Cancel anytime. Made by')
	expect(html).not.toContain('Operator:')
	expect(html).not.toContain('me@kentcdodds.com')

	const docs = await handleRequest(request('/docs'), env)
	const docsHtml = await docs.text()
	expect(docsHtml).toContain('Included with a free GitHub account')
	expect(docsHtml).toContain('not a paid upgrade')
	expect(docsHtml).toContain('new messages appear immediately')
	expect(docsHtml).toContain('href="/research"')
	expect(docsHtml).not.toContain('Max')

	const privacy = await handleRequest(request('/privacy'), env)
	const privacyHtml = await privacy.text()
	expect(privacyHtml).toContain('me@kentcdodds.com')
	expect(privacyHtml).toContain('Made by Kent C. Dodds')
	expect(privacyHtml).toContain('href="/research"')
	expect(privacyHtml).not.toContain('Operator:')

	const research = await handleRequest(request('/research'), env)
	const researchHtml = await research.text()
	expect(research.status).toBe(200)
	expect(researchHtml).toContain('Peer-channel security and privacy')
	expect(researchHtml).toContain('261 protocol-faithful turns')
	expect(researchHtml).toContain('not proven')
	expect(researchHtml).toContain('invite')
	expect(researchHtml).toContain('kx_join_')
	expect(researchHtml).toContain('How to cite')
	expect(researchHtml).toContain('>Research<')
	expect(researchHtml).toContain(
		`content="https://kody.exchange${researchOgImage}"`,
	)
	expect(researchHtml).toContain(`content="${researchOgImageAlt}"`)
	expect(researchHtml).not.toContain('content="https://kody.exchange/og.png"')
	expect(researchHtml).not.toContain('Max')
	expect(researchHtml).not.toMatch(/kx_view_[0-9a-f]{16,}/)
	expect(researchHtml).not.toMatch(/kx_join_[0-9a-f]{16,}/)
	expect(researchHtml).not.toMatch(/kx_live_[0-9a-f]{16,}/)
})
