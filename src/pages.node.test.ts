import { expect, test } from 'vitest'
import { handleRequest } from '#src/index.ts'
import {
	createSignedInUser,
	createTestEnv,
	firstSetCookie,
	request,
} from '#src/test-support.ts'

test('signed-in account is threads, not agent tokens', async () => {
	const env = createTestEnv()
	const { cookie } = await createSignedInUser(env)

	const page = await handleRequest(
		request('/account', { headers: { cookie } }),
		env,
	)
	expect(page.status).toBe(200)
	const html = await page.text()
	expect(html).toContain('Create thread')
	expect(html).toContain("What's this thread for?")
	expect(html).toContain('What should we call your agent?')
	expect(html).toContain('placeholder="my-agent"')
	expect(html).toContain('not a token or password')
	expect(html).toContain('Paste the first prompt into')
	expect(html).toContain('None yet')
	expect(html).not.toContain('e.g. cursor')
	expect(html).not.toContain('placeholder="cursor"')
	expect(html).not.toContain('Create agent token')
	expect(html).not.toContain('live agent tokens')
	expect(html).not.toContain('New agent token')
	expect(html).toContain('included with a signed-in account')
})

test('creating a thread shows a connect prompt and a join prompt once', async () => {
	const env = createTestEnv()
	const { cookie, csrf } = await createSignedInUser(env)

	const created = await handleRequest(
		request('/account/threads', {
			method: 'POST',
			headers: {
				cookie,
				'content-type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				csrf,
				purpose: 'pair on the billing bug',
				name: 'cursor',
			}),
		}),
		env,
	)
	expect(created.status).toBe(303)
	expect(created.headers.get('location')).toBe('/account')
	const flash = firstSetCookie(created)
	expect(flash).toMatch(/^kx_flash=/)

	const withPrompts = await handleRequest(
		request('/account', { headers: { cookie: `${cookie}; ${flash}` } }),
		env,
	)
	expect(withPrompts.status).toBe(200)
	const html = await withPrompts.text()
	expect(html).toContain('1. Give this to your agent')
	expect(html).toContain('2. Give this to other agents')
	expect(html).toContain('already a member')
	expect(html).toContain('their agent can join')
	expect(html).toContain('already in this kody.exchange thread as cursor')
	expect(html).toContain('Join this kody.exchange thread')
	expect(html).toContain('pair on the billing bug')
	expect(html).toContain('kx_live_')
	expect(html).toContain('kx_join_')
	expect(html).toContain('1 in the thread')
	expect(html).toContain('shown once')
	expect(html).toContain('Open the read-only chat')
	expect(html).toContain('/t/')
	expect(html).not.toContain("What's this thread for?")

	const again = await handleRequest(
		request('/account', { headers: { cookie } }),
		env,
	)
	const later = await again.text()
	expect(later).toContain('pair on the billing bug')
	expect(later).toContain('1 in the thread')
	expect(later).toContain('Open read-only chat')
	expect(later).toContain('/t/')
	expect(later).toContain("What's this thread for?")
	expect(later).not.toContain('Give this to your agent')
	expect(later).not.toContain('kx_live_')
	expect(later).not.toContain('kx_join_')
})

test('operator can grant the hidden plan; public pages do not name it', async () => {
	const env = createTestEnv()
	const operator = await createSignedInUser(env, {
		id: 'usr_op',
		github_id: '99',
		login: 'kentcdodds',
		plan: 'max',
	})
	const page = await handleRequest(
		request('/account', { headers: { cookie: operator.cookie } }),
		env,
	)
	const html = await page.text()
	expect(html).toContain('Max')
	expect(html).toContain('Grant Max')
	expect(html).not.toContain('Upgrade to Pro')
	expect(html).not.toContain('Manage subscription')

	const other = await createSignedInUser(env, {
		id: 'usr_other',
		github_id: '7',
		login: 'someoneelse',
		plan: 'free',
	})
	const granted = await handleRequest(
		request('/account/grants', {
			method: 'POST',
			headers: {
				cookie: operator.cookie,
				'content-type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				csrf: operator.csrf,
				login: 'SomeoneElse',
			}),
		}),
		env,
	)
	expect(granted.status).toBe(303)
	expect(granted.headers.get('location')).toBe(
		'https://kody.exchange/account?granted=1',
	)

	const otherPage = await handleRequest(
		request('/account', { headers: { cookie: other.cookie } }),
		env,
	)
	const otherHtml = await otherPage.text()
	expect(otherHtml).toContain('Max')
	expect(otherHtml).not.toContain('Grant Max')
	expect(otherHtml).not.toContain('Upgrade to Pro')

	const stranger = await createSignedInUser(env, {
		id: 'usr_stranger',
		github_id: '8',
		login: 'jane',
	})
	const strangerPage = await handleRequest(
		request('/account', { headers: { cookie: stranger.cookie } }),
		env,
	)
	const strangerHtml = await strangerPage.text()
	expect(strangerHtml).toContain('Free')
	expect(strangerHtml).not.toContain('Grant Max')
	expect(strangerHtml).not.toContain('Max')

	const denied = await handleRequest(
		request('/account/grants', {
			method: 'POST',
			headers: {
				cookie: stranger.cookie,
				'content-type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				csrf: stranger.csrf,
				login: 'anyone',
			}),
		}),
		env,
	)
	expect(denied.status).toBe(404)
})

test('a granted max account can still manage an existing Stripe subscription', async () => {
	const env = createTestEnv()
	const subscriber = await createSignedInUser(env, {
		id: 'usr_sub',
		github_id: '11',
		login: 'formerpro',
		plan: 'max',
		stripe_customer_id: 'cus_sub',
		stripe_subscription_id: 'sub_sub',
	})
	const page = await handleRequest(
		request('/account', { headers: { cookie: subscriber.cookie } }),
		env,
	)
	const html = await page.text()
	expect(html).toContain('Max')
	expect(html).toContain('Manage subscription')
	expect(html).not.toContain('Upgrade to Pro')
	expect(html).not.toContain('Grant Max')
})

test('thread view shows host prompt only to the signed-in owner', async () => {
	const env = createTestEnv()
	const owner = await createSignedInUser(env, {
		id: 'usr_owner',
		github_id: '21',
		login: 'owner',
	})
	const stranger = await createSignedInUser(env, {
		id: 'usr_stranger',
		github_id: '22',
		login: 'stranger',
	})
	const created = await handleRequest(
		request('/account/threads', {
			method: 'POST',
			headers: {
				cookie: owner.cookie,
				'content-type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				csrf: owner.csrf,
				purpose: 'owner-only host prompt',
				name: 'host-agent',
			}),
		}),
		env,
	)
	expect(created.status).toBe(303)
	const flash = firstSetCookie(created)
	const withPrompts = await handleRequest(
		request('/account', { headers: { cookie: `${owner.cookie}; ${flash}` } }),
		env,
	)
	const accountHtml = await withPrompts.text()
	const viewPath = /\/t\/kx_view_[a-f0-9]+/.exec(accountHtml)?.[0]
	expect(viewPath).toBeTruthy()

	const ownerView = await (
		await handleRequest(
			request(viewPath ?? '/', { headers: { cookie: owner.cookie } }),
			env,
		)
	).text()
	expect(ownerView).toContain('>Host<')
	expect(ownerView).toContain('>Guest<')
	expect(ownerView).toContain(
		'already in this kody.exchange thread as host-agent',
	)
	expect(ownerView).toContain('kx_live_')
	expect(ownerView).toContain('kx_join_')

	const publicView = await (
		await handleRequest(request(viewPath ?? '/'), env)
	).text()
	expect(publicView).toContain('>Guest<')
	expect(publicView).toContain('kx_join_')
	expect(publicView).not.toContain('>Host<')
	expect(publicView).toContain('kx_live_…')
	expect(publicView).not.toMatch(/kx_live_[a-f0-9]{16,}/)

	const strangerView = await (
		await handleRequest(
			request(viewPath ?? '/', { headers: { cookie: stranger.cookie } }),
			env,
		)
	).text()
	expect(strangerView).toContain('>Guest<')
	expect(strangerView).not.toContain('>Host<')
	expect(strangerView).toContain('kx_live_…')
	expect(strangerView).not.toMatch(/kx_live_[a-f0-9]{16,}/)
})

test('thread view aligns host messages right for the owner and guest messages right for everyone else', async () => {
	const env = createTestEnv()
	const owner = await createSignedInUser(env, {
		id: 'usr_align',
		github_id: '31',
		login: 'aligner',
	})
	const created = await handleRequest(
		request('/account/threads', {
			method: 'POST',
			headers: {
				cookie: owner.cookie,
				'content-type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				csrf: owner.csrf,
				purpose: 'align the chat',
				name: 'host-agent',
			}),
		}),
		env,
	)
	expect(created.status).toBe(303)
	const flash = firstSetCookie(created)
	const accountHtml = await (
		await handleRequest(
			request('/account', { headers: { cookie: `${owner.cookie}; ${flash}` } }),
			env,
		)
	).text()
	const viewPath = /\/t\/kx_view_[a-f0-9]+/.exec(accountHtml)?.[0]
	const hostToken = /kx_live_[a-f0-9]+/.exec(accountHtml)?.[0]
	const joinToken = /kx_join_[a-f0-9]+/.exec(accountHtml)?.[0]
	expect(viewPath && hostToken && joinToken).toBeTruthy()

	const hostSend = await handleRequest(
		request('/v1/messages', {
			method: 'POST',
			headers: {
				authorization: `Bearer ${hostToken}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify({ body: { text: 'host says hello' } }),
		}),
		env,
	)
	expect(hostSend.status).toBe(200)

	const joined = await handleRequest(
		request('/v1/join', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ join_token: joinToken, name: 'guest-agent' }),
		}),
		env,
	)
	const joinedBody = (await joined.json()) as { token: string }
	const guestSend = await handleRequest(
		request('/v1/messages', {
			method: 'POST',
			headers: {
				authorization: `Bearer ${joinedBody.token}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify({ body: { text: 'guest replies' } }),
		}),
		env,
	)
	expect(guestSend.status).toBe(200)

	const ownerView = await (
		await handleRequest(
			request(viewPath ?? '/', { headers: { cookie: owner.cookie } }),
			env,
		)
	).text()
	expect(ownerView).toContain('data-viewer="host"')
	expect(ownerView).toMatch(/data-mine[\s\S]*host says hello/)
	expect(ownerView).toMatch(
		/data-agent="[^"]+"(?![^>]*data-mine)[^>]*>[\s\S]*guest replies/,
	)

	const publicView = await (
		await handleRequest(request(viewPath ?? '/'), env)
	).text()
	expect(publicView).toContain('data-viewer="guest"')
	expect(publicView).toMatch(/data-mine[\s\S]*guest replies/)
	expect(publicView).toMatch(
		/data-agent="[^"]+"(?![^>]*data-mine)[^>]*>[\s\S]*host says hello/,
	)
})
