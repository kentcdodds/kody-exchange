import { type AppEnv, appBaseUrl } from '#src/env.ts'
import { getPlan, pollMinIntervalMsFor } from '#src/limits.ts'
import {
	clientIp,
	limitGuestCreates,
	limitMessageBurst,
	limitPoll,
	workerPollCache,
} from '#src/rate-limit.ts'
import {
	createThread,
	dispatchWebhook,
	getAgentByToken,
	getAgentByViewHostToken,
	joinThread,
	listMessages,
	requireMember,
	sendMessage,
	setWebhook,
	threadViewUrlFor,
	type DomainError,
} from '#src/threads.ts'
import { createId } from '#src/ids.ts'
import { first, run } from '#src/db.ts'

export function json(data: unknown, status = 200, extra: HeadersInit = {}) {
	const headers = new Headers(extra)
	headers.set('content-type', 'application/json; charset=utf-8')
	headers.set('cache-control', 'no-store')
	headers.set('access-control-allow-origin', '*')
	headers.set('access-control-allow-headers', 'Authorization, Content-Type')
	headers.set('access-control-allow-methods', 'GET, POST, PUT, OPTIONS')
	return new Response(JSON.stringify(data), { status, headers })
}

export function corsPreflight() {
	return json({ ok: true }, 204)
}

function bearer(request: Request) {
	const header = request.headers.get('authorization')
	if (!header?.startsWith('Bearer ')) return null
	const token = header.slice('Bearer '.length).trim()
	return token.length > 0 ? token : null
}

export function errorResponse(error: DomainError, retryAfter?: number) {
	const headers: Record<string, string> = {}
	if (retryAfter !== undefined) headers['retry-after'] = String(retryAfter)
	return json(
		{ ok: false, error: error.error, code: error.code },
		error.status,
		headers,
	)
}

async function readJson(request: Request) {
	const text = await request.text()
	if (!text) return {}
	try {
		return JSON.parse(text) as Record<string, unknown>
	} catch {
		return null
	}
}

async function requireAgent(request: Request, env: AppEnv, threadId?: string) {
	const token = bearer(request)
	if (!token) {
		return {
			ok: false as const,
			response: json(
				{ ok: false, error: 'Missing bearer token.', code: 'unauthorized' },
				401,
			),
		}
	}
	const agent =
		(await getAgentByToken(env.DB, token)) ??
		(threadId ? await getAgentByViewHostToken(env.DB, threadId, token) : null)
	if (!agent) {
		return {
			ok: false as const,
			response: json(
				{ ok: false, error: 'Invalid agent token.', code: 'unauthorized' },
				401,
			),
		}
	}
	return { ok: true as const, agent }
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

export async function handleApi(request: Request, env: AppEnv) {
	const url = new URL(request.url)
	if (request.method === 'OPTIONS' && url.pathname.startsWith('/v1/')) {
		return corsPreflight()
	}

	if (url.pathname === '/v1/threads' && request.method === 'POST') {
		return createThreadRoute(request, env)
	}

	const join = url.pathname.match(/^\/v1\/threads\/([^/]+)\/join$/)
	if (join?.[1] && request.method === 'POST') {
		return joinThreadRoute(request, env, join[1])
	}

	const messages = url.pathname.match(/^\/v1\/threads\/([^/]+)\/messages$/)
	if (messages?.[1] && request.method === 'POST') {
		return sendRoute(request, env, messages[1])
	}
	if (messages?.[1] && request.method === 'GET') {
		return pollRoute(request, env, messages[1])
	}

	const webhook = url.pathname.match(/^\/v1\/threads\/([^/]+)\/webhook$/)
	if (webhook?.[1] && request.method === 'PUT') {
		return webhookRoute(request, env, webhook[1])
	}

	const blobs = url.pathname.match(/^\/v1\/threads\/([^/]+)\/blobs$/)
	if (blobs?.[1] && request.method === 'POST') {
		return uploadBlob(request, env, blobs[1])
	}

	const blobGet = url.pathname.match(/^\/v1\/blobs\/([^/]+)$/)
	if (blobGet?.[1] && request.method === 'GET') {
		return getBlob(request, env, blobGet[1])
	}

	if (url.pathname.startsWith('/v1/')) {
		return json({ ok: false, error: 'Not found.', code: 'not_found' }, 404)
	}
	return null
}

async function createThreadRoute(request: Request, env: AppEnv) {
	const body = await readJson(request)
	if (!body)
		return json({ ok: false, error: 'Invalid JSON.', code: 'bad_json' }, 400)

	const token = bearer(request)
	let ownerUserId: string | null = null
	if (token) {
		const agent = await getAgentByToken(env.DB, token)
		if (!agent) {
			return json(
				{ ok: false, error: 'Invalid agent token.', code: 'unauthorized' },
				401,
			)
		}
		if (!agent.user_id) {
			return json(
				{
					ok: false,
					error: 'Guest tokens cannot open another thread.',
					code: 'guest_readonly',
				},
				403,
			)
		}
		ownerUserId = agent.user_id
	} else {
		const limited = await limitGuestCreates({
			store: env.RATE_LIMIT,
			ip: clientIp(request),
		})
		if (!limited.ok) {
			return json(
				{
					ok: false,
					error: 'Too many guest threads from this IP.',
					code: 'rate_limited',
				},
				429,
				{ 'retry-after': String(limited.retryAfterSeconds) },
			)
		}
	}

	const created = await createThread({
		db: env.DB,
		baseUrl: appBaseUrl(env, request),
		ownerUserId,
		creatorIp: ownerUserId ? null : clientIp(request),
		purpose: body.purpose,
		name: body.name,
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

async function joinThreadRoute(
	request: Request,
	env: AppEnv,
	threadId: string,
) {
	const body = await readJson(request)
	if (!body)
		return json({ ok: false, error: 'Invalid JSON.', code: 'bad_json' }, 400)
	const joinToken =
		(typeof body.join_token === 'string' && body.join_token) || bearer(request)
	if (!joinToken) {
		return json(
			{ ok: false, error: 'Missing join_token.', code: 'bad_join_token' },
			400,
		)
	}
	const joined = await joinThread({
		db: env.DB,
		threadId,
		joinToken,
		name: body.name,
	})
	if (!joined.ok) return errorResponse(joined)
	return json({
		ok: true,
		thread: threadJson(joined.thread),
		agent: { id: joined.agent.id, name: joined.agent.name },
		token: joined.token,
		view_url: await threadViewUrlFor(appBaseUrl(env, request), joined.thread),
		plan: joined.plan,
	})
}

async function sendRoute(request: Request, env: AppEnv, threadId: string) {
	const auth = await requireAgent(request, env, threadId)
	if (!auth.ok) return auth.response
	const burst = await limitMessageBurst({
		store: env.RATE_LIMIT,
		agentId: auth.agent.id,
	})
	if (!burst.ok) {
		return json(
			{
				ok: false,
				error: 'Slow down. Respect Retry-After.',
				code: 'rate_limited',
			},
			429,
			{ 'retry-after': String(burst.retryAfterSeconds) },
		)
	}
	const body = await readJson(request)
	if (!body)
		return json({ ok: false, error: 'Invalid JSON.', code: 'bad_json' }, 400)
	const sent = await sendMessage({
		db: env.DB,
		threadId,
		agent: auth.agent,
		kind: body.kind,
		body: body.body,
		refs: body.refs,
	})
	if (!sent.ok) return errorResponse(sent)
	const thread = await first<{ webhook_url: string | null }>(
		env.DB,
		'SELECT webhook_url FROM threads WHERE id = ?',
		threadId,
	)
	if (thread?.webhook_url) {
		void dispatchWebhook(thread.webhook_url, sent.message)
	}
	return json({ ok: true, message: sent.message })
}

async function pollRoute(request: Request, env: AppEnv, threadId: string) {
	const auth = await requireAgent(request, env, threadId)
	if (!auth.ok) return auth.response
	const thread = await first<{ owner_user_id: string | null }>(
		env.DB,
		'SELECT owner_user_id FROM threads WHERE id = ?',
		threadId,
	)
	const limited = await limitPoll({
		store: env.RATE_LIMIT,
		cache: workerPollCache(),
		agentId: auth.agent.id,
		threadId,
		minIntervalMs: pollMinIntervalMsFor(thread),
	})
	if (!limited.ok) {
		return json(
			{
				ok: false,
				error: 'Poll slower. Respect Retry-After.',
				code: 'rate_limited',
			},
			429,
			{ 'retry-after': String(limited.retryAfterSeconds) },
		)
	}
	const url = new URL(request.url)
	const listed = await listMessages({
		db: env.DB,
		threadId,
		agent: auth.agent,
		after: url.searchParams.get('after'),
		limit: Number(url.searchParams.get('limit') ?? 50),
	})
	if (!listed.ok) return errorResponse(listed)
	return json(
		{ ok: true, messages: listed.messages, retry_after: listed.retryAfter },
		200,
		{ 'retry-after': String(listed.retryAfter) },
	)
}

async function webhookRoute(request: Request, env: AppEnv, threadId: string) {
	const auth = await requireAgent(request, env, threadId)
	if (!auth.ok) return auth.response
	const body = await readJson(request)
	if (!body)
		return json({ ok: false, error: 'Invalid JSON.', code: 'bad_json' }, 400)
	const result = await setWebhook({
		db: env.DB,
		threadId,
		agent: auth.agent,
		url: body.url,
	})
	if (!result.ok) return errorResponse(result)
	return json({ ok: true, url: result.url })
}

async function uploadBlob(request: Request, env: AppEnv, threadId: string) {
	const auth = await requireAgent(request, env, threadId)
	if (!auth.ok) return auth.response
	const membership = await requireMember({
		db: env.DB,
		threadId,
		agent: auth.agent,
	})
	if (!membership.ok) return errorResponse(membership)
	const plan = getPlan(membership.plan)
	if (!plan.blobs) {
		return json(
			{ ok: false, error: 'Blobs are a Pro feature.', code: 'upgrade' },
			402,
		)
	}
	const ownerId = membership.thread.owner_user_id
	if (!ownerId) {
		return json(
			{
				ok: false,
				error: 'Blobs need an account-owned thread.',
				code: 'upgrade',
			},
			402,
		)
	}
	const bytes = await request.arrayBuffer()
	if (bytes.byteLength === 0) {
		return json({ ok: false, error: 'Empty body.', code: 'bad_blob' }, 400)
	}
	if (bytes.byteLength > plan.maxFileBytes) {
		return json(
			{ ok: false, error: 'File exceeds 25 MB.', code: 'blob_too_large' },
			413,
		)
	}
	const used = await first<{ n: number }>(
		env.DB,
		'SELECT COALESCE(SUM(byte_size), 0) AS n FROM blobs WHERE user_id = ?',
		ownerId,
	)
	if ((used?.n ?? 0) + bytes.byteLength > plan.blobBytes) {
		return json(
			{ ok: false, error: 'Account blob quota is 1 GB.', code: 'blob_quota' },
			402,
		)
	}
	const id = createId('blb')
	const contentType =
		request.headers.get('content-type') ?? 'application/octet-stream'
	await env.BLOBS.put(id, bytes, { httpMetadata: { contentType } })
	await run(
		env.DB,
		`INSERT INTO blobs (id, user_id, thread_id, content_type, byte_size, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		id,
		ownerId,
		threadId,
		contentType,
		bytes.byteLength,
		Date.now(),
	)
	return json({
		ok: true,
		blob: { id, bytes: bytes.byteLength, content_type: contentType },
	})
}

async function getBlob(request: Request, env: AppEnv, blobId: string) {
	if (!bearer(request)) {
		return json(
			{ ok: false, error: 'Missing bearer token.', code: 'unauthorized' },
			401,
		)
	}
	const blob = await first<{
		id: string
		user_id: string
		thread_id: string | null
	}>(env.DB, 'SELECT id, user_id, thread_id FROM blobs WHERE id = ?', blobId)
	if (!blob)
		return json({ ok: false, error: 'Not found.', code: 'not_found' }, 404)
	const auth = await requireAgent(request, env, blob.thread_id ?? undefined)
	if (!auth.ok) return auth.response
	if (blob.thread_id) {
		const membership = await requireMember({
			db: env.DB,
			threadId: blob.thread_id,
			agent: auth.agent,
		})
		if (!membership.ok) return errorResponse(membership)
	} else if (auth.agent.user_id !== blob.user_id) {
		return json({ ok: false, error: 'Forbidden.', code: 'forbidden' }, 403)
	}
	const object = await env.BLOBS.get(blobId)
	if (!object)
		return json({ ok: false, error: 'Not found.', code: 'not_found' }, 404)
	return new Response(object.body, {
		headers: {
			'content-type':
				object.httpMetadata?.contentType ?? 'application/octet-stream',
			'access-control-allow-origin': '*',
		},
	})
}
