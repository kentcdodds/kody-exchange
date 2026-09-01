import { expect, test } from 'vitest'
import { createOwnedThread } from '#src/user-api.ts'
import {
	createSignedInUser,
	createTestEnv,
	request,
} from '#src/test-support.ts'
import { type UserRow } from '#src/threads.ts'

test('createOwnedThread rejects a user without an id instead of D1_TYPE_ERROR', async () => {
	const env = createTestEnv()
	const broken = {
		id: undefined,
		github_id: '9',
		login: 'ghost',
		name: null,
		avatar_url: null,
		email: null,
		plan: 'free',
		stripe_customer_id: null,
		stripe_subscription_id: null,
		created_at: 1,
	} as unknown as UserRow

	const response = await createOwnedThread(
		request('/api/threads', { method: 'POST' }),
		env,
		broken,
		{ purpose: 'should-not-insert' },
	)
	expect(response.status).toBe(401)
	expect(await response.json()).toMatchObject({
		ok: false,
		code: 'invalid_token',
	})
})

test('createOwnedThread creates an owned thread for a signed-in user', async () => {
	const env = createTestEnv()
	const { user } = await createSignedInUser(env)
	const response = await createOwnedThread(
		request('/api/threads', { method: 'POST' }),
		env,
		user,
		{ purpose: 'owned', name: 'cursor' },
	)
	expect(response.status).toBe(200)
	const body = (await response.json()) as {
		ok: boolean
		thread: { id: string }
		plan: string
	}
	expect(body).toMatchObject({ ok: true, plan: 'free' })
	expect(body.thread.id).toMatch(/^th_/)
})
