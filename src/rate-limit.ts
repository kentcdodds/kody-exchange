import {
	guestCreatePerHour,
	guestPollMinIntervalMs,
	messageBurstPerMinute,
	pollKvPersistMs,
	pollMinIntervalMs,
} from '#src/limits.ts'

export type RateLimitStore = Pick<KVNamespace, 'get' | 'put'>

export type RateLimitResult =
	| { ok: true; remaining: number }
	| { ok: false; retryAfterSeconds: number }

export type PollCache = Pick<Cache, 'match' | 'put'>

async function consumeWindow(input: {
	store: RateLimitStore
	key: string
	limit: number
	windowSeconds: number
	now: number
}): Promise<RateLimitResult> {
	const raw = await input.store.get(input.key)
	const count = raw ? Number.parseInt(raw, 10) : 0
	if (Number.isFinite(count) && count >= input.limit) {
		return { ok: false, retryAfterSeconds: input.windowSeconds }
	}
	await input.store.put(
		input.key,
		String((Number.isFinite(count) ? count : 0) + 1),
		{
			expirationTtl: input.windowSeconds,
		},
	)
	return {
		ok: true,
		remaining: Math.max(
			0,
			input.limit - (Number.isFinite(count) ? count : 0) - 1,
		),
	}
}

export async function limitGuestCreates(input: {
	store: RateLimitStore
	ip: string
	now?: number
}) {
	const now = input.now ?? Date.now()
	const hour = Math.floor(now / 3_600_000)
	return consumeWindow({
		store: input.store,
		key: `guest-create:${input.ip}:${hour}`,
		limit: guestCreatePerHour,
		windowSeconds: 3600,
		now,
	})
}

export async function limitMessageBurst(input: {
	store: RateLimitStore
	agentId: string
	now?: number
}) {
	const now = input.now ?? Date.now()
	const minute = Math.floor(now / 60_000)
	return consumeWindow({
		store: input.store,
		key: `msg-burst:${input.agentId}:${minute}`,
		limit: messageBurstPerMinute,
		windowSeconds: 60,
		now,
	})
}

export function workerPollCache(): PollCache | null {
	try {
		return typeof caches === 'undefined' ? null : caches.default
	} catch {
		return null
	}
}

function pollCacheRequest(key: string) {
	return new Request(`https://kx-rl.invalid/${encodeURIComponent(key)}`)
}

export async function limitPoll(input: {
	store: RateLimitStore
	cache?: PollCache | null
	agentId: string
	threadId: string
	minIntervalMs?: number
	persistEveryMs?: number
	now?: number
}): Promise<RateLimitResult> {
	return limitInterval({
		store: input.store,
		cache: input.cache,
		key: `poll:${input.agentId}:${input.threadId}`,
		minIntervalMs: input.minIntervalMs ?? pollMinIntervalMs,
		persistEveryMs: input.persistEveryMs ?? pollKvPersistMs,
		now: input.now,
	})
}

export async function limitViewPoll(input: {
	store: RateLimitStore
	cache?: PollCache | null
	ip: string
	threadId: string
	minIntervalMs?: number
	persistEveryMs?: number
	now?: number
}): Promise<RateLimitResult> {
	return limitInterval({
		store: input.store,
		cache: input.cache,
		key: `view-poll:${input.ip}:${input.threadId}`,
		minIntervalMs: input.minIntervalMs ?? guestPollMinIntervalMs,
		persistEveryMs: input.persistEveryMs ?? pollKvPersistMs,
		now: input.now,
	})
}

async function limitInterval(input: {
	store: RateLimitStore
	cache?: PollCache | null
	key: string
	minIntervalMs: number
	persistEveryMs: number
	now?: number
}): Promise<RateLimitResult> {
	const now = input.now ?? Date.now()
	const retryAfterSeconds = Math.max(1, Math.ceil(input.minIntervalMs / 1000))
	const cacheRequest = pollCacheRequest(input.key)
	if (input.cache) {
		const hit = await input.cache.match(cacheRequest)
		if (hit) return { ok: false, retryAfterSeconds }
	}

	const raw = await input.store.get(input.key)
	const last = raw ? Number.parseInt(raw, 10) : Number.NaN
	if (Number.isFinite(last) && now - last < input.minIntervalMs) {
		return { ok: false, retryAfterSeconds }
	}

	if (input.cache) {
		await input.cache.put(
			cacheRequest,
			new Response('1', {
				headers: {
					'cache-control': `max-age=${retryAfterSeconds}`,
				},
			}),
		)
	}

	const shouldWriteKv =
		!input.cache || !Number.isFinite(last) || now - last >= input.persistEveryMs
	if (shouldWriteKv) {
		await input.store.put(input.key, String(now), { expirationTtl: 60 })
	}
	return { ok: true, remaining: 1 }
}

export function clientIp(request: Request) {
	return (
		request.headers.get('cf-connecting-ip') ??
		request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
		'unknown'
	)
}

export function copyClientIpHeaders(from: Headers, to: Headers) {
	const connectingIp = from.get('cf-connecting-ip')
	if (connectingIp) to.set('cf-connecting-ip', connectingIp)
	const forwardedFor = from.get('x-forwarded-for')
	if (forwardedFor) to.set('x-forwarded-for', forwardedFor)
}
