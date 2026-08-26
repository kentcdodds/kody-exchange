import { expect, test } from 'vitest'
import { createTestEnv } from '#src/test-support.ts'
import {
	archiveThread,
	archiveThreadAsHost,
	countOwnedThreads,
	createAccountAgent,
	createThread,
	deleteThread,
	deleteThreadAsHost,
	getAgentByToken,
	joinThread,
	joinTokenFor,
	listMessages,
	listMessagesForView,
	listThreadMembers,
	liveTokenFor,
	maybeDispatchWebhook,
	purgeExpired,
	sendMessage,
	setThreadNeverExpires,
	setWebhook,
	viewTokenFor,
} from '#src/threads.ts'
import { guestLiveThreadCap } from '#src/limits.ts'
import { run } from '#src/db.ts'

test('guest thread create, join, send, and poll is a closed loop', async () => {
	const env = createTestEnv()
	const now = Date.parse('2026-08-14T00:00:00Z')
	const created = await createThread({
		db: env.DB,
		baseUrl: 'https://kody.exchange',
		ownerUserId: null,
		purpose: 'pair on a bug',
		name: 'cursor',
		now,
	})
	if (!created.ok) throw new Error(created.error)
	expect(created.plan).toBe('guest')
	expect(created.connectPrompt).toContain(created.token)
	expect(created.connectPrompt).toContain(
		'POST https://kody.exchange/v1/messages',
	)
	expect(created.connectPrompt).not.toContain(created.thread.id)
	expect(created.connectPrompt).toContain(
		'already in this kody.exchange thread',
	)
	expect(created.joinPrompt).toContain('POST https://kody.exchange/v1/join')
	expect(created.joinPrompt).toContain(created.joinToken)
	expect(created.joinPrompt).not.toContain(created.thread.id)
	expect(created.joinPrompt).toContain('kody.exchange')
	expect(created.connectPrompt).not.toContain(created.joinToken)
	expect(created.joinPrompt).not.toContain(created.token)
	expect(created.viewUrl).toMatch(
		/^https:\/\/kody\.exchange\/t\/kx_view_[0-9a-f]{48}$/,
	)
	expect(created.connectPrompt).toContain(created.viewUrl)
	expect(created.joinPrompt).toContain(created.viewUrl)
	expect(created.viewUrl).not.toContain(created.joinToken)
	expect(created.viewUrl).not.toContain(created.token)
	expect(created.viewUrl).not.toContain(created.thread.id)

	const joined = await joinThread({
		db: env.DB,
		joinToken: created.joinToken,
		name: 'claude',
		now: now + 1000,
	})
	if (!joined.ok) throw new Error(joined.error)
	expect(joined.agent.name).toBe('claude')

	const third = await joinThread({
		db: env.DB,
		joinToken: created.joinToken,
		name: 'extra',
		now: now + 2000,
	})
	expect(third).toMatchObject({ ok: false, code: 'participant_limit' })

	const sent = await sendMessage({
		db: env.DB,
		threadId: created.thread.id,
		agent: created.agent,
		body: { text: 'hello from cursor' },
		now: now + 2000,
	})
	if (!sent.ok) throw new Error(sent.error)
	expect(sent.message.body).toEqual({ text: 'hello from cursor' })
	expect(sent.message.from.name).toBe('cursor')

	const listed = await listMessages({
		db: env.DB,
		threadId: created.thread.id,
		agent: joined.agent,
		after: '0',
		now: now + 2000,
	})
	if (!listed.ok) throw new Error(listed.error)
	expect(listed.messages.map((message) => message.body)).toEqual([
		{ text: 'cursor joined.' },
		{ text: 'claude joined.' },
		{ text: 'hello from cursor' },
	])
	expect(listed.messages.map((message) => message.kind)).toEqual([
		'system',
		'system',
		'message',
	])
	expect(listed.messages[2]?.id).toBe(sent.message.id)
	expect(listed.retryAfter).toBe(5)

	const viewToken = await viewTokenFor(created.thread)
	expect(viewToken).toMatch(/^kx_view_[0-9a-f]{48}$/)
	const viewed = await listMessagesForView({
		db: env.DB,
		viewToken,
		now: now + 2000,
	})
	if (!viewed.ok) throw new Error(viewed.error)
	expect(viewed.messages.map((message) => message.body)).toEqual([
		{ text: 'cursor joined.' },
		{ text: 'claude joined.' },
		{ text: 'hello from cursor' },
	])
	expect(viewed.members.map((member) => member.name)).toEqual([
		'cursor',
		'claude',
	])
	expect(viewed.seats).toBe(2)
	expect(viewed.retryAfter).toBe(5)

	const badView = await listMessagesForView({
		db: env.DB,
		viewToken: created.joinToken,
	})
	expect(badView).toMatchObject({
		ok: false,
		status: 404,
		code: 'thread_not_found',
	})

	const viewJoin = await joinThread({
		db: env.DB,
		joinToken: await joinTokenFor(created.thread),
		name: 'from-view',
		now: now + 2000,
	})
	expect(viewJoin).toMatchObject({ ok: false, code: 'participant_limit' })
})

test('HMAC-derived live and join tokens match the minted secrets', async () => {
	const env = createTestEnv()
	const created = await createThread({
		db: env.DB,
		baseUrl: 'https://kody.exchange',
		ownerUserId: null,
		purpose: 'copy prompts from the view',
		name: 'host-agent',
	})
	if (!created.ok) throw new Error(created.error)
	const hostToken = await liveTokenFor(created.thread, created.agent.id)
	const guestToken = await joinTokenFor(created.thread)
	expect(hostToken).toBe(created.token)
	expect(guestToken).toBe(created.joinToken)
	expect((await getAgentByToken(env.DB, hostToken))?.id).toBe(created.agent.id)

	const joined = await joinThread({
		db: env.DB,
		joinToken: guestToken,
		name: 'guest-agent',
	})
	if (!joined.ok) throw new Error(joined.error)
	expect(joined.agent.name).toBe('guest-agent')
	expect(joined.token).toBe(await liveTokenFor(created.thread, joined.agent.id))

	const sent = await sendMessage({
		db: env.DB,
		threadId: created.thread.id,
		agent: created.agent,
		body: { text: 'from the host live token' },
	})
	expect(sent.ok).toBe(true)
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
			`INSERT INTO threads (id, owner_user_id, purpose, thread_secret, view_token_hash, join_token_hash, webhook_url, created_at, expires_at, creator_ip)
			 VALUES (?, NULL, NULL, 'secret', ?, ?, NULL, ?, ?, ?)`,
			`th_cap_${index}`,
			`view_cap_${index}`,
			`join_cap_${index}`,
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

test('create can set a webhook; bad urls are rejected', async () => {
	const env = createTestEnv()
	const created = await createThread({
		db: env.DB,
		baseUrl: 'https://kody.exchange',
		ownerUserId: null,
		name: 'cursor',
		webhookUrl: 'https://hooks.example.test/room',
	})
	if (!created.ok) throw new Error(created.error)
	expect(created.thread.webhook_url).toBe('https://hooks.example.test/room')
	expect((await listThreadMembers(env.DB, created.thread.id))[0]?.webhook).toBe(
		true,
	)

	const bad = await createThread({
		db: env.DB,
		baseUrl: 'https://kody.exchange',
		ownerUserId: null,
		creatorIp: '198.51.100.40',
		name: 'cursor',
		webhookUrl: 'http://insecure.example.test/room',
	})
	expect(bad).toMatchObject({ ok: false, code: 'bad_webhook' })

	const emptyHost = await createThread({
		db: env.DB,
		baseUrl: 'https://kody.exchange',
		ownerUserId: null,
		creatorIp: '198.51.100.41',
		name: 'cursor',
		webhookUrl: 'https://',
	})
	expect(emptyHost).toMatchObject({ ok: false, code: 'bad_webhook' })
})

test('polling a thread records last_poll_at', async () => {
	const env = createTestEnv()
	const now = Date.parse('2026-08-14T00:00:00Z')
	const created = await createThread({
		db: env.DB,
		baseUrl: 'https://kody.exchange',
		ownerUserId: null,
		name: 'cursor',
		now,
	})
	if (!created.ok) throw new Error(created.error)
	const beforePoll = await listThreadMembers(env.DB, created.thread.id)
	expect(beforePoll[0]?.last_poll_at).toBeNull()
	const listed = await listMessages({
		db: env.DB,
		threadId: created.thread.id,
		agent: created.agent,
		after: '0',
		now: now + 8_000,
	})
	if (!listed.ok) throw new Error(listed.error)
	expect(listed.messages[0]?.body).toEqual({ text: 'cursor joined.' })
	const viewed = await listMessagesForView({
		db: env.DB,
		viewToken: await viewTokenFor(created.thread),
		now: now + 8_000,
	})
	if (!viewed.ok) throw new Error(viewed.error)
	expect(viewed.members[0]?.last_poll_at).toBe(
		new Date(now + 8_000).toISOString(),
	)
	expect(viewed.members[0]?.webhook).toBe(false)
	expect(viewed.members[0]?.last_seen_via).toBe('poll')
	expect(viewed.members[0]?.last_seen_message_id).toBe(
		listed.messages.at(-1)?.id,
	)
	expect(JSON.stringify(viewed.members[0])).not.toContain('webhook_url')
})

test('a later poll of an older page does not rewind last_seen', async () => {
	const env = createTestEnv()
	const now = Date.parse('2026-08-26T12:00:00.000Z')
	const created = await createThread({
		db: env.DB,
		baseUrl: 'https://kody.exchange',
		ownerUserId: null,
		name: 'cursor',
		now,
	})
	if (!created.ok) throw new Error(created.error)
	const first = await sendMessage({
		db: env.DB,
		threadId: created.thread.id,
		agent: created.agent,
		body: { text: 'one' },
		now: now + 1_000,
	})
	if (!first.ok) throw new Error(first.error)
	const second = await sendMessage({
		db: env.DB,
		threadId: created.thread.id,
		agent: created.agent,
		body: { text: 'two' },
		now: now + 2_000,
	})
	if (!second.ok) throw new Error(second.error)
	const caughtUp = await listMessages({
		db: env.DB,
		threadId: created.thread.id,
		agent: created.agent,
		after: '0',
		now: now + 3_000,
	})
	if (!caughtUp.ok) throw new Error(caughtUp.error)
	expect(caughtUp.messages.at(-1)?.id).toBe(second.message.id)
	const olderPage = await listMessages({
		db: env.DB,
		threadId: created.thread.id,
		agent: created.agent,
		after: '0',
		limit: 1,
		now: now + 4_000,
	})
	if (!olderPage.ok) throw new Error(olderPage.error)
	expect(olderPage.messages).toHaveLength(1)
	expect(olderPage.messages[0]?.id).not.toBe(second.message.id)
	const members = await listThreadMembers(env.DB, created.thread.id)
	expect(members[0]?.last_seen_message_id).toBe(second.message.id)
	expect(members[0]?.last_seen_via).toBe('poll')
})

test('join still returns a token when the join notice cannot be posted', async () => {
	const env = createTestEnv()
	const now = Date.parse('2026-08-14T00:00:00Z')
	const created = await createThread({
		db: env.DB,
		baseUrl: 'https://kody.exchange',
		ownerUserId: null,
		name: 'cursor',
		now,
	})
	if (!created.ok) throw new Error(created.error)
	await run(
		env.DB,
		`INSERT INTO usage_months (owner_key, yyyymm, message_count)
		 VALUES (?, '2026-08', 50)
		 ON CONFLICT (owner_key, yyyymm) DO UPDATE SET message_count = 50`,
		`guest:${created.thread.id}`,
	)
	const joined = await joinThread({
		db: env.DB,
		joinToken: created.joinToken,
		name: 'claude',
		now: now + 1000,
	})
	if (!joined.ok) throw new Error(joined.error)
	expect(joined.token).toMatch(/^kx_live_/)
	expect(joined.joinedMessage).toBeNull()
	expect(
		(await listThreadMembers(env.DB, created.thread.id)).map(
			(member) => member.name,
		),
	).toEqual(['cursor', 'claude'])
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

test('host can archive a thread; send, poll, join, and webhook then fail', async () => {
	const env = createTestEnv()
	const now = Date.parse('2026-08-16T00:00:00Z')
	const created = await createThread({
		db: env.DB,
		baseUrl: 'https://kody.exchange',
		ownerUserId: null,
		creatorIp: '203.0.113.50',
		name: 'cursor',
		webhookUrl: 'https://hooks.example.test/room',
		now,
	})
	if (!created.ok) throw new Error(created.error)
	const joined = await joinThread({
		db: env.DB,
		joinToken: created.joinToken,
		name: 'claude',
		now: now + 1000,
	})
	if (!joined.ok) throw new Error(joined.error)

	const guestArchive = await archiveThreadAsHost({
		db: env.DB,
		threadId: created.thread.id,
		agent: joined.agent,
		now: now + 2000,
	})
	expect(guestArchive).toMatchObject({ ok: false, code: 'not_host' })

	const archived = await archiveThreadAsHost({
		db: env.DB,
		threadId: created.thread.id,
		agent: created.agent,
		now: now + 2000,
	})
	if (!archived.ok) throw new Error(archived.error)
	expect(archived.thread.archived_at).toBe(now + 2000)
	expect(archived.thread.webhook_url).toBeNull()
	expect((await listThreadMembers(env.DB, created.thread.id))[0]?.webhook).toBe(
		false,
	)

	const sent = await sendMessage({
		db: env.DB,
		threadId: created.thread.id,
		agent: created.agent,
		body: { text: 'too late' },
		now: now + 3000,
	})
	expect(sent).toMatchObject({
		ok: false,
		status: 409,
		code: 'thread_archived',
	})
	if (sent.ok) throw new Error('expected send to fail')
	expect(sent.error).toContain('read-only')

	const polled = await listMessages({
		db: env.DB,
		threadId: created.thread.id,
		agent: joined.agent,
		after: '0',
		now: now + 3000,
	})
	expect(polled).toMatchObject({
		ok: false,
		status: 409,
		code: 'thread_archived',
	})

	const lateJoin = await joinThread({
		db: env.DB,
		joinToken: created.joinToken,
		name: 'late',
		now: now + 3000,
	})
	expect(lateJoin).toMatchObject({ ok: false, code: 'thread_archived' })

	const webhook = await setWebhook({
		db: env.DB,
		threadId: created.thread.id,
		agent: created.agent,
		url: 'https://hooks.example.test/other',
		now: now + 3000,
	})
	expect(webhook).toMatchObject({ ok: false, code: 'thread_archived' })

	const viewed = await listMessagesForView({
		db: env.DB,
		viewToken: await viewTokenFor(created.thread),
		now: now + 3000,
	})
	if (!viewed.ok) throw new Error(viewed.error)
	expect(viewed.thread.archived_at).toBe(now + 2000)
	expect(viewed.messages.map((message) => message.body)).toEqual([
		{ text: 'cursor joined.' },
		{ text: 'claude joined.' },
	])

	const again = await createThread({
		db: env.DB,
		baseUrl: 'https://kody.exchange',
		ownerUserId: null,
		creatorIp: '203.0.113.50',
		name: 'next',
		now: now + 4000,
	})
	expect(again.ok).toBe(true)

	const webhookCalls: Array<string> = []
	const originalFetch = globalThis.fetch
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		webhookCalls.push(String(input))
		return new Response('ok')
	}) as typeof fetch
	try {
		await maybeDispatchWebhook(env.DB, created.thread.id, {
			id: 'msg_x',
			at: new Date(now).toISOString(),
			from: { agent_id: created.agent.id, name: 'cursor' },
			thread: created.thread.id,
			kind: 'message',
			body: { text: 'should not fire' },
			refs: [],
		})
		expect(webhookCalls).toEqual([])
	} finally {
		globalThis.fetch = originalFetch
	}

	const idempotent = await archiveThread({
		db: env.DB,
		threadId: created.thread.id,
		now: now + 5000,
	})
	if (!idempotent.ok) throw new Error(idempotent.error)
	expect(idempotent.thread.archived_at).toBe(now + 2000)
})

test('webhook dispatch stays alive through waitUntil', async () => {
	const env = createTestEnv()
	const created = await createThread({
		db: env.DB,
		baseUrl: 'https://kody.exchange',
		ownerUserId: null,
		name: 'cursor',
	})
	if (!created.ok) throw new Error(created.error)
	const webhook = await setWebhook({
		db: env.DB,
		threadId: created.thread.id,
		agent: created.agent,
		url: 'https://example.test/hook',
	})
	if (!webhook.ok) throw new Error(webhook.error)
	const sent = await sendMessage({
		db: env.DB,
		threadId: created.thread.id,
		agent: created.agent,
		body: { text: 'ping' },
	})
	if (!sent.ok) throw new Error(sent.error)

	const waited: Array<Promise<unknown>> = []
	const ctx = {
		waitUntil(promise: Promise<unknown>) {
			waited.push(promise)
		},
	} as ExecutionContext
	const webhookCalls: Array<string> = []
	const originalFetch = globalThis.fetch
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		webhookCalls.push(String(input))
		return new Response('ok')
	}) as typeof fetch
	try {
		await maybeDispatchWebhook(env.DB, created.thread.id, sent.message, ctx)
		expect(waited).toHaveLength(1)
		await waited[0]
		expect(webhookCalls).toEqual(['https://example.test/hook'])
		expect(
			(await listThreadMembers(env.DB, created.thread.id))[0]?.webhook,
		).toBe(true)
	} finally {
		globalThis.fetch = originalFetch
	}
})

test('a successful peer webhook records a read receipt', async () => {
	const env = createTestEnv()
	const now = Date.parse('2026-08-26T12:00:00.000Z')
	const created = await createThread({
		db: env.DB,
		baseUrl: 'https://kody.exchange',
		ownerUserId: null,
		name: 'cursor',
		now,
	})
	if (!created.ok) throw new Error(created.error)
	const joined = await joinThread({
		db: env.DB,
		joinToken: created.joinToken,
		name: 'claude',
		now: now + 1_000,
	})
	if (!joined.ok) throw new Error(joined.error)
	const webhook = await setWebhook({
		db: env.DB,
		threadId: created.thread.id,
		agent: joined.agent,
		url: 'https://example.test/hook',
	})
	if (!webhook.ok) throw new Error(webhook.error)
	const sent = await sendMessage({
		db: env.DB,
		threadId: created.thread.id,
		agent: created.agent,
		body: { text: 'hello claude' },
		now: now + 2_000,
	})
	if (!sent.ok) throw new Error(sent.error)
	const originalFetch = globalThis.fetch
	globalThis.fetch = (async () => new Response('ok')) as typeof fetch
	try {
		await maybeDispatchWebhook(env.DB, created.thread.id, sent.message)
	} finally {
		globalThis.fetch = originalFetch
	}
	const members = await listThreadMembers(env.DB, created.thread.id)
	expect(members.find((member) => member.id === joined.agent.id)).toMatchObject(
		{
			webhook: true,
			last_seen_via: 'webhook',
			last_seen_message_id: sent.message.id,
		},
	)
	expect(
		members.find((member) => member.id === created.agent.id),
	).toMatchObject({
		webhook: false,
		last_seen_via: 'send',
		last_seen_message_id: sent.message.id,
	})
})

test('one webhook URL shared by two members receipts both', async () => {
	const env = createTestEnv()
	const now = Date.parse('2026-08-26T13:00:00.000Z')
	const created = await createThread({
		db: env.DB,
		baseUrl: 'https://kody.exchange',
		ownerUserId: null,
		name: 'cursor',
		webhookUrl: 'https://example.test/shared',
		now,
	})
	if (!created.ok) throw new Error(created.error)
	const joined = await joinThread({
		db: env.DB,
		joinToken: created.joinToken,
		name: 'claude',
		now: now + 1_000,
	})
	if (!joined.ok) throw new Error(joined.error)
	const webhook = await setWebhook({
		db: env.DB,
		threadId: created.thread.id,
		agent: joined.agent,
		url: 'https://example.test/shared',
	})
	if (!webhook.ok) throw new Error(webhook.error)
	const sent = await sendMessage({
		db: env.DB,
		threadId: created.thread.id,
		agent: created.agent,
		body: { text: 'hello both' },
		now: now + 2_000,
	})
	if (!sent.ok) throw new Error(sent.error)
	const webhookCalls: Array<string> = []
	const originalFetch = globalThis.fetch
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		webhookCalls.push(String(input))
		return new Response('ok')
	}) as typeof fetch
	try {
		await maybeDispatchWebhook(env.DB, created.thread.id, sent.message)
	} finally {
		globalThis.fetch = originalFetch
	}
	expect(webhookCalls).toEqual(['https://example.test/shared'])
	const members = await listThreadMembers(env.DB, created.thread.id)
	expect(
		members.map((member) => ({
			id: member.id,
			via: member.last_seen_via,
			seen: member.last_seen_message_id,
		})),
	).toEqual([
		{
			id: created.agent.id,
			via: 'webhook',
			seen: sent.message.id,
		},
		{
			id: joined.agent.id,
			via: 'webhook',
			seen: sent.message.id,
		},
	])
})

test('a failed webhook does not count as a read receipt', async () => {
	const env = createTestEnv()
	const created = await createThread({
		db: env.DB,
		baseUrl: 'https://kody.exchange',
		ownerUserId: null,
		name: 'cursor',
		webhookUrl: 'https://example.test/hook',
	})
	if (!created.ok) throw new Error(created.error)
	const sent = await sendMessage({
		db: env.DB,
		threadId: created.thread.id,
		agent: created.agent,
		body: { text: 'ping' },
	})
	if (!sent.ok) throw new Error(sent.error)
	const originalFetch = globalThis.fetch
	globalThis.fetch = (async () =>
		new Response('no', { status: 500 })) as typeof fetch
	try {
		await maybeDispatchWebhook(env.DB, created.thread.id, sent.message)
	} finally {
		globalThis.fetch = originalFetch
	}
	const members = await listThreadMembers(env.DB, created.thread.id)
	expect(members[0]?.last_seen_via).toBe('send')
	expect(members[0]?.last_seen_message_id).toBe(sent.message.id)
})

test('owner can keep a thread forever; it still counts as live and survives purge', async () => {
	const env = createTestEnv()
	const now = Date.parse('2026-08-17T00:00:00Z')
	await run(
		env.DB,
		`INSERT INTO users (id, github_id, login, name, avatar_url, email, plan, stripe_customer_id, stripe_subscription_id, created_at)
		 VALUES (?, ?, ?, ?, NULL, NULL, 'free', NULL, NULL, ?)`,
		'usr_keep',
		'42',
		'keeper',
		'Keeper',
		now,
	)
	const first = await createThread({
		db: env.DB,
		baseUrl: 'https://kody.exchange',
		ownerUserId: 'usr_keep',
		purpose: 'keep me',
		name: 'host',
		now,
	})
	if (!first.ok) throw new Error(first.error)
	const kept = await setThreadNeverExpires({
		db: env.DB,
		threadId: first.thread.id,
		neverExpires: true,
		now: now + 1000,
	})
	expect(kept.ok).toBe(true)
	if (!kept.ok) throw new Error(kept.error)
	expect(kept.thread.never_expires_at).toBe(now + 1000)
	expect(kept.thread.expires_at).toBe(first.thread.expires_at)

	const sent = await sendMessage({
		db: env.DB,
		threadId: first.thread.id,
		agent: first.agent,
		body: { text: 'still here' },
		now: now + 2000,
	})
	if (!sent.ok) throw new Error(sent.error)
	const afterSend = await setThreadNeverExpires({
		db: env.DB,
		threadId: first.thread.id,
		neverExpires: true,
		now: now + 3000,
	})
	if (!afterSend.ok) throw new Error(afterSend.error)
	expect(afterSend.thread.expires_at).toBe(first.thread.expires_at)
	expect(afterSend.thread.never_expires_at).toBe(now + 1000)

	await run(
		env.DB,
		'UPDATE threads SET expires_at = ? WHERE id = ?',
		now - 1,
		first.thread.id,
	)
	expect(await purgeExpired(env.DB, now + 4000)).toBe(0)
	const viewed = await listMessagesForView({
		db: env.DB,
		viewToken: await viewTokenFor(first.thread),
		now: now + 4000,
	})
	if (!viewed.ok) throw new Error(viewed.error)
	expect(viewed.thread.never_expires_at).toBe(now + 1000)

	const second = await createThread({
		db: env.DB,
		baseUrl: 'https://kody.exchange',
		ownerUserId: 'usr_keep',
		purpose: 'two',
		name: 'host',
		now: now + 5000,
	})
	if (!second.ok) throw new Error(second.error)
	const third = await createThread({
		db: env.DB,
		baseUrl: 'https://kody.exchange',
		ownerUserId: 'usr_keep',
		purpose: 'three',
		name: 'host',
		now: now + 6000,
	})
	if (!third.ok) throw new Error(third.error)
	expect(await countOwnedThreads(env.DB, 'usr_keep')).toBe(3)
	const fourth = await createThread({
		db: env.DB,
		baseUrl: 'https://kody.exchange',
		ownerUserId: 'usr_keep',
		purpose: 'four',
		name: 'host',
		now: now + 7000,
	})
	expect(fourth).toMatchObject({ ok: false, code: 'thread_limit' })

	const restored = await setThreadNeverExpires({
		db: env.DB,
		threadId: first.thread.id,
		neverExpires: false,
		now: now + 8000,
	})
	if (!restored.ok) throw new Error(restored.error)
	expect(restored.thread.never_expires_at).toBeNull()
	expect(restored.thread.expires_at).toBeGreaterThan(now + 8000)
})

test('guest threads cannot be kept; host can hard-delete and free the IP slot', async () => {
	const env = createTestEnv()
	const now = Date.parse('2026-08-17T00:00:00Z')
	const created = await createThread({
		db: env.DB,
		baseUrl: 'https://kody.exchange',
		ownerUserId: null,
		creatorIp: '203.0.113.70',
		name: 'host',
		now,
	})
	if (!created.ok) throw new Error(created.error)
	const keep = await setThreadNeverExpires({
		db: env.DB,
		threadId: created.thread.id,
		neverExpires: true,
		now: now + 1000,
	})
	expect(keep).toMatchObject({ ok: false, code: 'keep_forbidden' })

	const joined = await joinThread({
		db: env.DB,
		joinToken: created.joinToken,
		name: 'guest',
		now: now + 2000,
	})
	if (!joined.ok) throw new Error(joined.error)
	const guestDelete = await deleteThreadAsHost({
		db: env.DB,
		threadId: created.thread.id,
		agent: joined.agent,
		now: now + 3000,
	})
	expect(guestDelete).toMatchObject({ ok: false, code: 'not_host' })

	const deleted = await deleteThreadAsHost({
		db: env.DB,
		threadId: created.thread.id,
		agent: created.agent,
		now: now + 3000,
	})
	if (!deleted.ok) throw new Error(deleted.error)
	expect(deleted.thread.id).toBe(created.thread.id)

	const gone = await listMessagesForView({
		db: env.DB,
		viewToken: await viewTokenFor(created.thread),
		now: now + 4000,
	})
	expect(gone).toMatchObject({ ok: false, code: 'thread_not_found' })

	const again = await createThread({
		db: env.DB,
		baseUrl: 'https://kody.exchange',
		ownerUserId: null,
		creatorIp: '203.0.113.70',
		name: 'next',
		now: now + 5000,
	})
	expect(again.ok).toBe(true)
})

test('deleteThread removes members and messages; missing threads 404', async () => {
	const env = createTestEnv()
	const created = await createThread({
		db: env.DB,
		baseUrl: 'https://kody.exchange',
		ownerUserId: null,
		creatorIp: '198.51.100.70',
		name: 'host',
	})
	if (!created.ok) throw new Error(created.error)
	const deleted = await deleteThread({
		db: env.DB,
		threadId: created.thread.id,
	})
	if (!deleted.ok) throw new Error(deleted.error)
	expect(await listThreadMembers(env.DB, created.thread.id)).toEqual([])
	const missing = await deleteThread({
		db: env.DB,
		threadId: created.thread.id,
	})
	expect(missing).toMatchObject({ ok: false, code: 'thread_not_found' })
})
