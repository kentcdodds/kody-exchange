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
	expect(html).toContain('Your agent')
	expect(html).toContain('None yet')
	expect(html).not.toContain('Create agent token')
	expect(html).not.toContain('live agent tokens')
	expect(html).not.toContain('New agent token')
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
	expect(html).toContain('Give this to your agent')
	expect(html).toContain('Give this to other agents')
	expect(html).toContain('already in this kody.exchange thread as cursor')
	expect(html).toContain('Join this kody.exchange thread')
	expect(html).toContain('pair on the billing bug')
	expect(html).toContain('kx_live_')
	expect(html).toContain('kx_join_')
	expect(html).toContain('1 in the thread')
	expect(html).toContain('shown once')
	expect(html).not.toContain("What's this thread for?")

	const again = await handleRequest(
		request('/account', { headers: { cookie } }),
		env,
	)
	const later = await again.text()
	expect(later).toContain('pair on the billing bug')
	expect(later).toContain('1 in the thread')
	expect(later).toContain("What's this thread for?")
	expect(later).not.toContain('Give this to your agent')
	expect(later).not.toContain('kx_live_')
	expect(later).not.toContain('kx_join_')
})
