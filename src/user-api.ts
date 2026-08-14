import { errorResponse, json } from '#src/api.ts'
import { maybeBroadcastThreadView } from '#src/thread-room.ts'
import { all, first } from '#src/db.ts'
import { type AppEnv, appBaseUrl } from '#src/env.ts'
import {
	createThread,
	getHostAgent,
	joinThread,
	listMessages,
	maybeDispatchWebhook,
	sendMessage,
	setWebhook,
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
}) {
	return {
		id: thread.id,
		purpose: thread.purpose,
		created_at: new Date(thread.created_at).toISOString(),
		expires_at: new Date(thread.expires_at).toISOString(),
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
		 WHERE t.owner_user_id = ? AND t.expires_at > ?
		 ORDER BY t.created_at DESC`,
		user.id,
		Date.now(),
	)
}

export async function createOwnedThread(
	request: Request,
	env: AppEnv,
	user: UserRow,
	input: { purpose?: unknown; name?: unknown },
) {
	const created = await createThread({
		db: env.DB,
		baseUrl: appBaseUrl(env, request),
		ownerUserId: user.id,
		purpose: input.purpose,
		name: input.name || user.login,
	})
	if (!created.ok) return errorResponse(created)
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

export async function handleUserApi(
	request: Request,
	env: AppEnv,
	user: UserRow,
	ctx?: ExecutionContext,
) {
	const url = new URL(request.url)
	if (url.pathname === '/api/me' && request.method === 'GET') {
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
		return createOwnedThread(request, env, user, body)
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
		await maybeDispatchWebhook(env.DB, owned.thread.id, sent.message, ctx)
		await maybeBroadcastThreadView(env, owned.thread.id, sent.message, ctx)
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
		return json({ ok: true, url: result.url })
	}

	return json({ ok: false, error: 'Not found.', code: 'not_found' }, 404)
}

export async function joinAsUser(
	env: AppEnv,
	input: { threadId: string; joinToken: unknown; name?: unknown },
) {
	if (typeof input.joinToken !== 'string') {
		return json(
			{ ok: false, error: 'join_token is required.', code: 'bad_join' },
			400,
		)
	}
	const joined = await joinThread({
		db: env.DB,
		threadId: input.threadId,
		joinToken: input.joinToken,
		name: input.name,
	})
	if (!joined.ok) return errorResponse(joined)
	return json({
		ok: true,
		thread: threadJson(joined.thread),
		agent: { id: joined.agent.id, name: joined.agent.name },
		token: joined.token,
		plan: joined.plan,
	})
}
