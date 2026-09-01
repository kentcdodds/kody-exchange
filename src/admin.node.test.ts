import { expect, test } from 'vitest'
import { handleRequest } from '#src/index.ts'
import { loadAdminInsights } from '#src/admin.ts'
import { run } from '#src/db.ts'
import {
	createSignedInUser,
	createTestEnv,
	request,
} from '#src/test-support.ts'

test('admin insights count users, rooms, and messages without bodies', async () => {
	const env = createTestEnv()
	// Wall-clock "this month" usage is recorded at send time; keep insights `now`
	// in the same UTC month so thisMonthGuest is not calendar-flaky.
	const now = Date.now()
	const day = new Date(now).toISOString().slice(0, 10)
	await createSignedInUser(env, {
		id: 'usr_op',
		github_id: '99',
		login: 'kentcdodds',
		email: 'me@kentcdodds.com',
		plan: 'max',
		created_at: now - 86_400_000,
		roles: ['admin'],
	})
	const friend = await createSignedInUser(env, {
		id: 'usr_friend',
		github_id: '7',
		login: 'someoneelse',
		name: 'Sam',
		email: 'sam@example.com',
		plan: 'free',
		created_at: now - 3_600_000,
	})

	const owned = await handleRequest(
		request('/account/threads', {
			method: 'POST',
			headers: {
				cookie: friend.cookie,
				'content-type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				csrf: friend.csrf,
				purpose: 'pair on the billing bug',
				name: 'cursor',
			}),
		}),
		env,
	)
	expect(owned.status).toBe(303)

	const guest = await handleRequest(
		request('/v1/threads', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'cf-connecting-ip': '203.0.113.9',
			},
			body: JSON.stringify({ purpose: 'guest demo', name: 'guest-agent' }),
		}),
		env,
	)
	const guestBody = (await guest.json()) as { token: string }
	const secret = await handleRequest(
		request('/v1/messages', {
			method: 'POST',
			headers: {
				authorization: `Bearer ${guestBody.token}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify({
				body: { text: 'super-secret-peer-body-do-not-leak' },
			}),
		}),
		env,
	)
	expect(secret.status).toBe(200)

	await run(
		env.DB,
		`INSERT INTO blobs (id, user_id, thread_id, content_type, byte_size, created_at)
		 VALUES (?, ?, NULL, 'text/plain', ?, ?)`,
		'bl_1',
		'usr_friend',
		2048,
		now,
	)

	const insights = await loadAdminInsights(env.DB, now)
	expect(insights.users.total).toBe(2)
	expect(insights.users.byPlan).toEqual({ free: 1, pro: 0, max: 1 })
	expect(insights.threads.liveOwned).toBe(1)
	expect(insights.threads.liveGuest).toBe(1)
	expect(insights.liveGuestIps).toBe(1)
	expect(insights.blobs.count).toBe(1)
	expect(insights.blobs.bytes).toBe(2048)
	expect(insights.messages.all).toBeGreaterThanOrEqual(2)
	expect(insights.messages.thisMonthGuest).toBeGreaterThanOrEqual(1)
	expect(insights.recentUsers.map((user) => user.login)).toEqual([
		'someoneelse',
		'kentcdodds',
	])
	expect(
		insights.recentThreads.some(
			(thread) => thread.purpose === 'pair on the billing bug' && !thread.guest,
		),
	).toBe(true)
	expect(
		insights.recentThreads.some(
			(thread) => thread.purpose === 'guest demo' && thread.guest,
		),
	).toBe(true)
	expect(JSON.stringify(insights)).not.toContain(
		'super-secret-peer-body-do-not-leak',
	)
	expect(JSON.stringify(insights)).not.toContain('203.0.113.9')
	expect(JSON.stringify(insights)).not.toContain('kx_live_')
	expect(insights.dailyMessages[0]?.day).toBe(day)
	expect(insights.dailyMessages).toHaveLength(14)
})

test('operator can open admin html and json; others cannot', async () => {
	const env = createTestEnv()
	const operator = await createSignedInUser(env, {
		id: 'usr_op',
		github_id: '99',
		login: 'kentcdodds',
		email: 'me@kentcdodds.com',
		plan: 'max',
		roles: ['admin'],
	})
	const stranger = await createSignedInUser(env, {
		id: 'usr_stranger',
		github_id: '8',
		login: 'jane',
	})

	const signedOut = await handleRequest(request('/admin'), env)
	expect(signedOut.status).toBe(302)
	expect(signedOut.headers.get('location')).toBe(
		'https://kody.exchange/auth/github?next=%2Fadmin',
	)

	const signedOutJson = await handleRequest(request('/admin.json'), env)
	expect(signedOutJson.status).toBe(401)

	const denied = await handleRequest(
		request('/admin', { headers: { cookie: stranger.cookie } }),
		env,
	)
	expect(denied.status).toBe(404)
	expect(denied.headers.get('content-type')).toContain('application/json')
	expect(await denied.text()).not.toContain('Usage')

	const deniedJson = await handleRequest(
		request('/admin.json', { headers: { cookie: stranger.cookie } }),
		env,
	)
	expect(deniedJson.status).toBe(404)

	const page = await handleRequest(
		request('/admin', { headers: { cookie: operator.cookie } }),
		env,
	)
	expect(page.status).toBe(200)
	const html = await page.text()
	expect(html).toContain('Usage')
	expect(html).toContain('noindex')
	expect(html).toContain('@kentcdodds')
	expect(html).toContain('@jane')
	expect(html).toContain('me@kentcdodds.com')
	expect(html).toContain('href="/admin"')
	expect(html).toContain('aria-current="page"')
	expect(html).toContain('/admin.json')
	expect(html).not.toContain('action="/account/grants"')

	const snapshot = await handleRequest(
		request('/admin.json', { headers: { cookie: operator.cookie } }),
		env,
	)
	expect(snapshot.status).toBe(200)
	expect(snapshot.headers.get('access-control-allow-origin')).toBeNull()
	const body = (await snapshot.json()) as {
		ok: boolean
		users: { total: number }
	}
	expect(body.ok).toBe(true)
	expect(body.users.total).toBe(2)
})

test('admin nav follows read:user:any, not the GitHub login', async () => {
	const env = createTestEnv()
	const operator = await createSignedInUser(env, {
		id: 'usr_op',
		github_id: '99',
		login: 'kentcdodds',
		plan: 'max',
		roles: ['admin'],
	})
	const stranger = await createSignedInUser(env, {
		id: 'usr_stranger',
		github_id: '8',
		login: 'jane',
	})

	const operatorHtml = await (
		await handleRequest(
			request('/account', { headers: { cookie: operator.cookie } }),
			env,
		)
	).text()
	expect(operatorHtml).toMatch(/<footer>[\s\S]*href="\/admin"/)
	expect(operatorHtml).not.toMatch(/<nav>[\s\S]*href="\/admin"[\s\S]*<\/nav>/)
	expect(operatorHtml).not.toContain('>Features</a>')

	const strangerHtml = await (
		await handleRequest(
			request('/account', { headers: { cookie: stranger.cookie } }),
			env,
		)
	).text()
	expect(strangerHtml).not.toContain('href="/admin"')
})
