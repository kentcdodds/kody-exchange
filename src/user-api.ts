import { errorResponse, json } from '#src/api.ts'
import {
	maybeBroadcastThreadView,
	maybeCloseThreadView,
} from '#src/thread-room.ts'
import { all, first } from '#src/db.ts'
import { type AppEnv, appBaseUrl } from '#src/env.ts'
import {
	archiveThread,
	createThread,
	deleteThread,
	getHostAgent,
	isThreadArchived,
	isThreadNeverExpiring,
	joinThread,
	listMessages,
	listThreadMembers,
	maybeDispatchWebhook,
	sendMessage,
	setThreadNeverExpires,
	setWebhook,
	sqlThreadLive,
	type ThreadRow,
	type UserRow,
} from '#src/threads.ts'

type ThreadListRow = ThreadRow & { member_count: number }

async function readJson(request: Request) {
	const text = await request.text()
	if (!text) return {}
	try {
		return JSON.parse(text) as Record<string, unknown>
	} catch {
		return null
	}
}

function threadJson(thread: {
	id: string
	purpose: string | null
	created_at: number
	expires_at: number
	archived_at?: number | null
	never_expires_at?: number | null
}) {
	const neverExpires = isThreadNeverExpiring(thread)
	return {
		id: thread.id,
		purpose: thread.purpose,
		created_at: new Date(thread.created_at).toISOString(),
		expires_at: neverExpires ? null : new Date(thread.expires_at).toISOString(),
		never_expires: neverExpires,
		archived: isThreadArchived(thread),
	}
}

async function requireOwnedThread(
	env: AppEnv,
	user: UserRow,
	threadId: string,
) {
	const thread = await first<ThreadRow>(
		env.DB,
		'SELECT * FROM threads WHERE id = ? AND owner_user_id = ?',
		threadId,
		user.id,
	)
	if (!thread) {
		return {
			ok: false as const,
			response: json(
				{ ok: false, error: 'Thread not found.', code: 'not_found' },
				404,
			),
		}
	}
	const host = await getHostAgent(env.DB, thread.id)
	if (!host) {
		return {
			ok: false as const,
			response: json(
				{ ok: false, error: 'Host agent missing.', code: 'host_missing' },
				500,
			),
		}
	}
	return { ok: true as const, thread, host }
}

async function listOwnedThreads(env: AppEnv, user: UserRow) {
	return all<ThreadListRow>(
		env.DB,
		`SELECT t.*, (
			 SELECT COUNT(*) FROM thread_members m WHERE m.thread_id = t.id
		 ) AS member_count
		 FROM threads t
		 WHERE t.owner_user_id = ? AND ${sqlThreadLive('t.')}
		 ORDER BY t.created_at DESC`,
		user.id,
		Date.now(),
	)
}

export async function createOwnedThread(
	request: Request,
	env: AppEnv,
	user: UserRow,
	input: { purpose?: unknown; name?: unknown; webhook_url?: unknown },
	ctx?: ExecutionContext,
) {
	// Owned creates must never fall through to the guest path: a missing
	// user.id is falsy, so createThread would bind undefined/null as a guest
	// insert and (before D1 null-coercion) throw D1_TYPE_ERROR.
	if (typeof user.id !== 'string' || user.id.length === 0) {
		return json(
			{
				ok: false,
				error: 'Signed-in user is missing an id. Re-authorize and try again.',
				code: 'invalid_token',
			},
			401,
		)
	}
	const created = await createThread({
		db: env.DB,
		baseUrl: appBaseUrl(env, request),
		ownerUserId: user.id,
		purpose: input.purpose,
		name: input.name || user.login,
		webhookUrl: input.webhook_url,
	})
	if (!created.ok) return errorResponse(created)
	await maybeBroadcastThreadView(
		env,
		created.thread.id,
		created.joinedMessage,
		ctx,
		{ members: await listThreadMembers(env.DB, created.thread.id) },
	)
	return json({
		ok: true,
		thread: threadJson(created.thread),
		agent: { id: created.agent.id, name: created.agent.name },
		token: created.token,
		join_token: created.joinToken,
		view_url: created.viewUrl,
		connect_prompt: created.connectPrompt,
		join_prompt: created.joinPrompt,
		plan: created.plan,
	})
}

function identityJson(user: UserRow) {
	return json({
		ok: true,
		user: {
			id: user.id,
			login: user.login,
			name: user.name,
			plan: user.plan,
		},
	})
}

export async function handleUserApi(
	request: Request,
	env: AppEnv,
	user: UserRow,
	ctx?: ExecutionContext,
) {
	const url = new URL(request.url)
	if (
		request.method === 'GET' &&
		(url.pathname === '/api/me' || url.pathname === '/api/profile')
	) {
		return identityJson(user)
	}

	if (url.pathname === '/api/threads' && request.method === 'GET') {
		const threads = await listOwnedThreads(env, user)
		return json({
			ok: true,
			threads: threads.map((thread) => ({
				...threadJson(thread),
				member_count: Number(thread.member_count),
			})),
		})
	}

	if (url.pathname === '/api/threads' && request.method === 'POST') {
		const body = await readJson(request)
		if (!body)
			return json({ ok: false, error: 'Invalid JSON.', code: 'bad_json' }, 400)
		return createOwnedThread(request, env, user, body, ctx)
	}

	const threadPath = url.pathname.match(/^\/api\/threads\/([^/]+)$/)
	if (threadPath?.[1] && request.method === 'GET') {
		const owned = await requireOwnedThread(env, user, threadPath[1])
		if (!owned.ok) return owned.response
		return json({ ok: true, thread: threadJson(owned.thread) })
	}

	const messages = url.pathname.match(/^\/api\/threads\/([^/]+)\/messages$/)
	if (messages?.[1] && request.method === 'GET') {
		const owned = await requireOwnedThread(env, user, messages[1])
		if (!owned.ok) return owned.response
		const listed = await listMessages({
			db: env.DB,
			threadId: owned.thread.id,
			agent: owned.host,
			after: url.searchParams.get('after'),
			limit: Number(url.searchParams.get('limit') ?? 50),
		})
		if (!listed.ok) return errorResponse(listed)
		await maybeBroadcastThreadView(env, owned.thread.id, null, ctx, {
			members: await listThreadMembers(env.DB, owned.thread.id),
		})
		return json({
			ok: true,
			messages: listed.messages,
			retry_after: listed.retryAfter,
		})
	}
	if (messages?.[1] && request.method === 'POST') {
		const owned = await requireOwnedThread(env, user, messages[1])
		if (!owned.ok) return owned.response
		const body = await readJson(request)
		if (!body)
			return json({ ok: false, error: 'Invalid JSON.', code: 'bad_json' }, 400)
		const sent = await sendMessage({
			db: env.DB,
			threadId: owned.thread.id,
			agent: owned.host,
			body: body.body,
			kind: body.kind,
			refs: body.refs,
		})
		if (!sent.ok) return errorResponse(sent)
		await maybeDispatchWebhook(
			env.DB,
			owned.thread.id,
			sent.message,
			ctx,
			async () => {
				await maybeBroadcastThreadView(env, owned.thread.id, null, undefined, {
					members: await listThreadMembers(env.DB, owned.thread.id),
				})
			},
		)
		await maybeBroadcastThreadView(env, owned.thread.id, sent.message, ctx, {
			members: await listThreadMembers(env.DB, owned.thread.id),
		})
		return json({ ok: true, message: sent.message })
	}

	const webhook = url.pathname.match(/^\/api\/threads\/([^/]+)\/webhook$/)
	if (webhook?.[1] && request.method === 'PUT') {
		const owned = await requireOwnedThread(env, user, webhook[1])
		if (!owned.ok) return owned.response
		const body = await readJson(request)
		if (!body)
			return json({ ok: false, error: 'Invalid JSON.', code: 'bad_json' }, 400)
		const result = await setWebhook({
			db: env.DB,
			threadId: owned.thread.id,
			agent: owned.host,
			url: body.url,
		})
		if (!result.ok) return errorResponse(result)
		await maybeBroadcastThreadView(env, owned.thread.id, null, ctx, {
			members: await listThreadMembers(env.DB, owned.thread.id),
		})
		return json({ ok: true, url: result.url })
	}

	const archive = url.pathname.match(/^\/api\/threads\/([^/]+)\/archive$/)
	if (archive?.[1] && request.method === 'POST') {
		const owned = await requireOwnedThread(env, user, archive[1])
		if (!owned.ok) return owned.response
		const archived = await archiveThread({
			db: env.DB,
			threadId: owned.thread.id,
		})
		if (!archived.ok) return errorResponse(archived)
		await maybeCloseThreadView(env, archived.thread.id, ctx)
		return json({ ok: true, thread: threadJson(archived.thread) })
	}

	const keep = url.pathname.match(/^\/api\/threads\/([^/]+)\/keep$/)
	if (keep?.[1] && request.method === 'POST') {
		const owned = await requireOwnedThread(env, user, keep[1])
		if (!owned.ok) return owned.response
		const kept = await setThreadNeverExpires({
			db: env.DB,
			threadId: owned.thread.id,
			neverExpires: true,
		})
		if (!kept.ok) return errorResponse(kept)
		return json({ ok: true, thread: threadJson(kept.thread) })
	}

	const expire = url.pathname.match(/^\/api\/threads\/([^/]+)\/expire$/)
	if (expire?.[1] && request.method === 'POST') {
		const owned = await requireOwnedThread(env, user, expire[1])
		if (!owned.ok) return owned.response
		const restored = await setThreadNeverExpires({
			db: env.DB,
			threadId: owned.thread.id,
			neverExpires: false,
		})
		if (!restored.ok) return errorResponse(restored)
		return json({ ok: true, thread: threadJson(restored.thread) })
	}

	const remove = url.pathname.match(/^\/api\/threads\/([^/]+)\/delete$/)
	if (remove?.[1] && request.method === 'POST') {
		const owned = await requireOwnedThread(env, user, remove[1])
		if (!owned.ok) return owned.response
		const deleted = await deleteThread({
			db: env.DB,
			threadId: owned.thread.id,
		})
		if (!deleted.ok) return errorResponse(deleted)
		await maybeCloseThreadView(env, deleted.thread.id, ctx)
		return json({ ok: true, deleted: true, thread: threadJson(deleted.thread) })
	}

	return json({ ok: false, error: 'Not found.', code: 'not_found' }, 404)
}

export async function joinAsUser(
	env: AppEnv,
	input: { joinToken: unknown; name?: unknown },
	ctx?: ExecutionContext,
) {
	if (typeof input.joinToken !== 'string') {
		return json(
			{ ok: false, error: 'join_token is required.', code: 'bad_join' },
			400,
		)
	}
	const joined = await joinThread({
		db: env.DB,
		joinToken: input.joinToken,
		name: input.name,
	})
	if (!joined.ok) return errorResponse(joined)
	await maybeBroadcastThreadView(
		env,
		joined.thread.id,
		joined.joinedMessage,
		ctx,
		{ members: await listThreadMembers(env.DB, joined.thread.id) },
	)
	return json({
		ok: true,
		thread: threadJson(joined.thread),
		agent: { id: joined.agent.id, name: joined.agent.name },
		token: joined.token,
		plan: joined.plan,
	})
}
