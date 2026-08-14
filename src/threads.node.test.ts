import { expect, test } from 'vitest'
import { createTestEnv } from '#src/test-support.ts'
import {
	createAccountAgent,
	createThread,
	joinThread,
	listMessages,
	sendMessage,
} from '#src/threads.ts'
import { guestLiveThreadCap } from '#src/limits.ts'
import { run } from '#src/db.ts'

test('guest thread create, join, send, and poll is a closed loop', async () => {
	const env = createTestEnv()
	const created = await createThread({
		db: env.DB,
		baseUrl: 'https://kody.exchange',
		ownerUserId: null,
		purpose: 'pair on a bug',
		name: 'cursor',
		now: Date.parse('2026-08-14T00:00:00Z'),
	})
	if (!created.ok) throw new Error(created.error)
	expect(created.plan).toBe('guest')
	expect(created.connectPrompt).toContain(created.token)
	expect(created.connectPrompt).toContain(
		`POST https://kody.exchange/v1/threads/${created.thread.id}/messages`,
	)
	expect(created.connectPrompt).toContain(
		'already in this kody.exchange thread',
	)
	expect(created.joinPrompt).toContain('POST https://kody.exchange/v1/threads/')
	expect(created.joinPrompt).toContain(created.joinToken)
	expect(created.joinPrompt).toContain('kody.exchange')
	expect(created.connectPrompt).not.toContain(created.joinToken)
	expect(created.joinPrompt).not.toContain(created.token)

	const joined = await joinThread({
		db: env.DB,
		threadId: created.thread.id,
		joinToken: created.joinToken,
		name: 'claude',
		now: Date.parse('2026-08-14T00:00:01Z'),
	})
	if (!joined.ok) throw new Error(joined.error)
	expect(joined.agent.name).toBe('claude')

	const third = await joinThread({
		db: env.DB,
		threadId: created.thread.id,
		joinToken: created.joinToken,
		name: 'extra',
	})
	expect(third).toMatchObject({ ok: false, code: 'participant_limit' })

	const sent = await sendMessage({
		db: env.DB,
		threadId: created.thread.id,
		agent: created.agent,
		body: { text: 'hello from cursor' },
		now: Date.parse('2026-08-14T00:00:02Z'),
	})
	if (!sent.ok) throw new Error(sent.error)
	expect(sent.message.body).toEqual({ text: 'hello from cursor' })
	expect(sent.message.from.name).toBe('cursor')

	const listed = await listMessages({
		db: env.DB,
		threadId: created.thread.id,
		agent: joined.agent,
		after: '0',
	})
	if (!listed.ok) throw new Error(listed.error)
	expect(listed.messages).toHaveLength(1)
	expect(listed.messages[0]?.id).toBe(sent.message.id)
	expect(listed.retryAfter).toBe(5)
})

test('guest threads are one live room per IP', async () => {
	const env = createTestEnv()
	const first = await createThread({
		db: env.DB,
		baseUrl: 'https://kody.exchange',
		ownerUserId: null,
		creatorIp: '203.0.113.8',
		name: 'one',
	})
	expect(first.ok).toBe(true)
	const second = await createThread({
		db: env.DB,
		baseUrl: 'https://kody.exchange',
		ownerUserId: null,
		creatorIp: '203.0.113.8',
		name: 'two',
	})
	expect(second).toMatchObject({ ok: false, code: 'guest_thread_limit' })
	const otherIp = await createThread({
		db: env.DB,
		baseUrl: 'https://kody.exchange',
		ownerUserId: null,
		creatorIp: '198.51.100.2',
		name: 'other',
	})
	expect(otherIp.ok).toBe(true)
})

test('guest create stops at the global live-thread cap', async () => {
	const env = createTestEnv()
	const now = Date.parse('2026-08-14T00:00:00Z')
	for (let index = 0; index < guestLiveThreadCap; index += 1) {
		await run(
			env.DB,
			`INSERT INTO threads (id, owner_user_id, purpose, join_secret_hash, webhook_url, created_at, expires_at, creator_ip)
			 VALUES (?, NULL, NULL, 'hash', NULL, ?, ?, ?)`,
			`th_cap_${index}`,
			now,
			now + 86_400_000,
			`203.0.113.${index % 250}`,
		)
	}
	const created = await createThread({
		db: env.DB,
		baseUrl: 'https://kody.exchange',
		ownerUserId: null,
		creatorIp: '198.51.100.9',
		now,
	})
	expect(created).toMatchObject({ ok: false, code: 'guest_capacity' })
})

test('free accounts cannot mint a fourth live agent token', async () => {
	const env = createTestEnv()
	await run(
		env.DB,
		`INSERT INTO users (id, github_id, login, name, avatar_url, email, plan, created_at)
		 VALUES ('usr_1', '1', 'kent', 'Kent', null, 'k@example.com', 'free', 1)`,
	)
	const user = {
		id: 'usr_1',
		github_id: '1',
		login: 'kent',
		name: 'Kent',
		avatar_url: null,
		email: 'k@example.com',
		plan: 'free' as const,
		stripe_customer_id: null,
		stripe_subscription_id: null,
		created_at: 1,
	}
	expect((await createAccountAgent({ db: env.DB, user, name: 'one' })).ok).toBe(
		true,
	)
	expect((await createAccountAgent({ db: env.DB, user, name: 'two' })).ok).toBe(
		true,
	)
	expect(
		(await createAccountAgent({ db: env.DB, user, name: 'three' })).ok,
	).toBe(true)
	const fourth = await createAccountAgent({ db: env.DB, user, name: 'four' })
	expect(fourth).toMatchObject({ ok: false, code: 'agent_limit' })
})
