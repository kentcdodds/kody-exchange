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
	expect(html).toContain('data-mcp-connect')
	expect(html).toContain('Connect MCP')
	expect(html).toContain('id="mcp-url"')
	expect(html).toContain('https://kody.exchange/mcp')
	expect(html).toContain('Copy MCP URL')
	expect(html).toContain('no prompt to copy')
	expect(html).toContain('href="/mcp"')
	expect(html).toContain('Create a thread from your agent')
	expect(html).toContain('Create a thread from a copied prompt')
	expect(html).toContain('class="thread-prompts" data-create-thread-prompt')
	expect(html).not.toMatch(
		/<details class="thread-prompts" data-create-thread-prompt[^>]*\bopen\b/,
	)
	expect(html).toContain('Copy create-a-thread prompt')
	expect(html).toContain('id="create-thread-prompt"')
	expect(html).toContain('already signed in as @kent')
	expect(html).toContain('Do not POST https://kody.exchange/v1/threads')
	expect(html).toContain('create_thread')
	expect(html).toContain('POST https://kody.exchange/api/threads')
	expect(html).toContain('data-copy="create-thread-prompt"')
	expect(html).toContain('data-copy="mcp-url"')
	expect(html).not.toContain('included with a signed-in account')
})

test('signed-in homepage shows the account create prompt, not guest /v1', async () => {
	const env = createTestEnv()
	const { cookie } = await createSignedInUser(env)

	const page = await handleRequest(request('/', { headers: { cookie } }), env)
	expect(page.status).toBe(200)
	const html = await page.text()
	expect(html).toContain('Agent prompt')
	expect(html).toContain('Paste the prompt')
	expect(html).toContain('not the guest room')
	expect(html).toContain('on the signed-in account')
	expect(html).toContain('already signed in as @kent')
	expect(html).toContain('Do not POST https://kody.exchange/v1/threads')
	expect(html).toContain('https://kody.exchange/mcp')
	expect(html).toContain('create_thread')
	expect(html).toContain('POST https://kody.exchange/api/threads')
	expect(html).toContain('Account rooms: at most once per second')
	expect(html).toContain('href="/account"')
	expect(html).toContain("You're signed in")
	expect(html).toContain('href="/start.md"')
	expect(html).not.toContain('POST https://kody.exchange/v1/threads\n')
	expect(html).not.toContain('Guest rooms: at least 5 seconds between polls')
	expect(html).not.toContain('one live thread per IP')
	expect(html).not.toContain('unlock the OAuth API and MCP')
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
	expect(html).toContain('1 of 3')
	expect(html).toContain('shown once')
	expect(html).toContain('Open the read-only chat')
	expect(html).toContain('treat the link as an invite until the room is full')
	expect(html).toContain('/t/')
	expect(html).not.toContain('cannot send messages or join agents')
	expect(html).not.toContain("What's this thread for?")

	const again = await handleRequest(
		request('/account', { headers: { cookie } }),
		env,
	)
	const later = await again.text()
	expect(later).toContain('pair on the billing bug')
	expect(later).toContain('1 of 3')
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
		roles: ['admin'],
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
	expect(ownerView).toContain('data-stamp')
	expect(ownerView).toContain('data-intro')
	expect(ownerView).toContain('class="thread-prompts" data-thread-prompts')
	expect(ownerView).toContain('<summary>Copy host or guest prompts</summary>')
	expect(ownerView).not.toMatch(/<details class="thread-prompts"[^>]*\bopen\b/)
	expect(ownerView).toContain('>Host<')
	expect(ownerView).toContain('>Guest<')
	expect(ownerView).toContain(
		'already in this kody.exchange thread as host-agent',
	)
	expect(ownerView).toContain('kx_live_')
	expect(ownerView).toContain('kx_join_')
	expect(ownerView).toContain('>Archive thread<')
	expect(ownerView).toContain('data-archive-thread')
	expect(ownerView).toContain(`action="${viewPath}/archive"`)
	expect(ownerView).toContain(`name="csrf" value="${owner.csrf}"`)

	const publicView = await (
		await handleRequest(request(viewPath ?? '/'), env)
	).text()
	expect(publicView).toContain('class="thread-prompts" data-thread-prompts')
	expect(publicView).toContain('<summary>Copy guest prompt</summary>')
	expect(publicView).not.toMatch(/<details class="thread-prompts"[^>]*\bopen\b/)
	expect(publicView).toContain('>Guest<')
	expect(publicView).toContain('kx_join_')
	expect(publicView).not.toContain('>Host<')
	expect(publicView).toContain('kx_live_…')
	expect(publicView).not.toMatch(/kx_live_[a-f0-9]{16,}/)
	expect(publicView).not.toContain('Archive thread')
	expect(publicView).not.toContain(`action="${viewPath}/archive"`)

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
	expect(strangerView).not.toContain('Archive thread')
	expect(strangerView).not.toContain(`action="${viewPath}/archive"`)
})

test('signed-in owner can archive from the watch page', async () => {
	const env = createTestEnv()
	const owner = await createSignedInUser(env, {
		id: 'usr_view_archive',
		github_id: '41',
		login: 'archiver',
	})
	const stranger = await createSignedInUser(env, {
		id: 'usr_view_archive_stranger',
		github_id: '42',
		login: 'onlooker',
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
				purpose: 'archive from the watch page',
				name: 'host-agent',
			}),
		}),
		env,
	)
	expect(created.status).toBe(303)
	const flash = firstSetCookie(created)
	const accountHtml = await (
		await handleRequest(
			request('/account', {
				headers: { cookie: `${owner.cookie}; ${flash}` },
			}),
			env,
		)
	).text()
	const viewPath = /\/t\/kx_view_[a-f0-9]+/.exec(accountHtml)?.[0]
	const hostToken = /kx_live_[a-f0-9]+/.exec(accountHtml)?.[0]
	expect(viewPath && hostToken).toBeTruthy()
	const archivePath = `${viewPath}/archive`

	const unsigned = await handleRequest(
		request(archivePath, {
			method: 'POST',
			headers: {
				'content-type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({ csrf: owner.csrf }),
		}),
		env,
	)
	expect(unsigned.status).toBe(302)
	expect(unsigned.headers.get('location')).toBe(
		'https://kody.exchange/auth/github',
	)

	const strangerPost = await handleRequest(
		request(archivePath, {
			method: 'POST',
			headers: {
				cookie: stranger.cookie,
				'content-type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({ csrf: stranger.csrf }),
		}),
		env,
	)
	expect(strangerPost.status).toBe(403)

	const badCsrf = await handleRequest(
		request(archivePath, {
			method: 'POST',
			headers: {
				cookie: owner.cookie,
				'content-type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({ csrf: 'nope' }),
		}),
		env,
	)
	expect(badCsrf.status).toBe(403)

	const missing = await handleRequest(
		request('/t/kx_view_missing/archive', {
			method: 'POST',
			headers: {
				cookie: owner.cookie,
				'content-type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({ csrf: owner.csrf }),
		}),
		env,
	)
	expect(missing.status).toBe(404)

	const getArchive = await handleRequest(
		request(archivePath, { headers: { cookie: owner.cookie } }),
		env,
	)
	expect(getArchive.status).toBe(404)

	const archived = await handleRequest(
		request(archivePath, {
			method: 'POST',
			headers: {
				cookie: owner.cookie,
				'content-type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({ csrf: owner.csrf }),
		}),
		env,
	)
	expect(archived.status).toBe(303)
	expect(archived.headers.get('location')).toBe(
		`https://kody.exchange${viewPath}`,
	)

	const later = await handleRequest(
		request(viewPath ?? '/', { headers: { cookie: owner.cookie } }),
		env,
	)
	expect(later.status).toBe(200)
	const laterHtml = await later.text()
	expect(laterHtml).toContain('Archived')
	expect(laterHtml).toContain('does not subscribe for updates')
	expect(laterHtml).toContain('archive from the watch page')
	expect(laterHtml).not.toContain('Archive thread')
	expect(laterHtml).not.toContain('data-archive-thread')
	expect(laterHtml).not.toContain('data-poll=')
	expect(laterHtml).not.toContain('data-live=')
	expect(laterHtml).not.toContain('connectLive()')

	const sent = await handleRequest(
		request('/v1/messages', {
			method: 'POST',
			headers: {
				authorization: `Bearer ${hostToken}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify({ body: { text: 'too late' } }),
		}),
		env,
	)
	expect(sent.status).toBe(409)
	expect(((await sent.json()) as { code: string }).code).toBe('thread_archived')
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

test('signed-in host can close a thread from the account page', async () => {
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
				purpose: 'close from account',
				name: 'host-agent',
			}),
		}),
		env,
	)
	expect(created.status).toBe(303)
	const flash = firstSetCookie(created)
	const withPrompts = await handleRequest(
		request('/account', { headers: { cookie: `${cookie}; ${flash}` } }),
		env,
	)
	const accountHtml = await withPrompts.text()
	expect(accountHtml).toContain('Close thread')
	const threadId = /th_[a-z0-9]+/.exec(accountHtml)?.[0]
	expect(threadId).toBeTruthy()

	const closed = await handleRequest(
		request(`/account/threads/${threadId}/archive`, {
			method: 'POST',
			headers: {
				cookie,
				'content-type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({ csrf }),
		}),
		env,
	)
	expect(closed.status).toBe(303)
	expect(closed.headers.get('location')).toBe(
		'https://kody.exchange/account?archived=1',
	)

	const later = await handleRequest(
		request('/account?archived=1', { headers: { cookie } }),
		env,
	)
	const laterHtml = await later.text()
	expect(laterHtml).toContain('Thread archived. It is read-only now.')
	expect(laterHtml).toContain('Archived')
	expect(laterHtml).toContain('close from account')
	expect(laterHtml).toContain("What's this thread for?")
	expect(laterHtml).not.toContain('Close thread')

	const missing = await handleRequest(
		request('/account/threads/th_missing/archive', {
			method: 'POST',
			headers: {
				cookie,
				'content-type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({ csrf }),
		}),
		env,
	)
	expect(missing.status).toBe(303)
	expect(missing.headers.get('location')).toContain('error=not_found')
	const missingPage = await handleRequest(
		request('/account?error=not_found', { headers: { cookie } }),
		env,
	)
	expect(await missingPage.text()).toContain('That thread was not found.')
	const failedPage = await handleRequest(
		request('/account?error=archive_failed', { headers: { cookie } }),
		env,
	)
	expect(await failedPage.text()).toContain(
		'Could not archive that thread. Try again.',
	)
	const expiredPage = await handleRequest(
		request('/account?error=thread_not_found', { headers: { cookie } }),
		env,
	)
	expect(await expiredPage.text()).toContain('That thread was not found.')
})

test('signed-in host can keep and hard-delete a thread from the account page', async () => {
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
				purpose: 'keep then delete',
				name: 'host-agent',
			}),
		}),
		env,
	)
	expect(created.status).toBe(303)
	const flash = firstSetCookie(created)
	const withPrompts = await handleRequest(
		request('/account', { headers: { cookie: `${cookie}; ${flash}` } }),
		env,
	)
	const accountHtml = await withPrompts.text()
	expect(accountHtml).toContain('Keep forever')
	expect(accountHtml).toContain('Delete thread')
	expect(accountHtml).toContain('data-delete-thread')
	expect(accountHtml).toContain('Deleting in ')
	expect(accountHtml).toContain('left = 10')
	const threadId = /th_[a-z0-9]+/.exec(accountHtml)?.[0]
	expect(threadId).toBeTruthy()

	const kept = await handleRequest(
		request(`/account/threads/${threadId}/keep`, {
			method: 'POST',
			headers: {
				cookie,
				'content-type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({ csrf }),
		}),
		env,
	)
	expect(kept.status).toBe(303)
	expect(kept.headers.get('location')).toBe(
		'https://kody.exchange/account?kept=1',
	)
	const keptPage = await handleRequest(
		request('/account?kept=1', { headers: { cookie } }),
		env,
	)
	const keptHtml = await keptPage.text()
	expect(keptHtml).toContain('This thread will not expire.')
	expect(keptHtml).toContain('never expires')
	expect(keptHtml).toContain('Allow to expire')
	expect(keptHtml).toContain('still counts as a live thread')

	const deleted = await handleRequest(
		request(`/account/threads/${threadId}/delete`, {
			method: 'POST',
			headers: {
				cookie,
				'content-type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({ csrf }),
		}),
		env,
	)
	expect(deleted.status).toBe(303)
	expect(deleted.headers.get('location')).toBe(
		'https://kody.exchange/account?deleted=1',
	)
	const later = await handleRequest(
		request('/account?deleted=1', { headers: { cookie } }),
		env,
	)
	const laterHtml = await later.text()
	expect(laterHtml).toContain('Thread deleted.')
	expect(laterHtml).not.toContain('keep then delete')
	expect(laterHtml).toContain("What's this thread for?")
})
