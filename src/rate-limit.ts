import {
	guestCreatePerHour,
	messageBurstPerMinute,
	pollMinIntervalMs,
} from '#src/limits.ts'

export type RateLimitStore = Pick<KVNamespace, 'get' | 'put'>

export type RateLimitResult =
	| { ok: true; remaining: number }
	| { ok: false; retryAfterSeconds: number }

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

export async function limitPoll(input: {
	store: RateLimitStore
	agentId: string
	threadId: string
	now?: number
}): Promise<RateLimitResult> {
	const now = input.now ?? Date.now()
	const key = `poll:${input.agentId}:${input.threadId}`
	const raw = await input.store.get(key)
	const last = raw ? Number.parseInt(raw, 10) : 0
	if (Number.isFinite(last) && now - last < pollMinIntervalMs) {
		return { ok: false, retryAfterSeconds: 1 }
	}
	await input.store.put(key, String(now), { expirationTtl: 60 })
	return { ok: true, remaining: 1 }
}

export function clientIp(request: Request) {
	return (
		request.headers.get('cf-connecting-ip') ??
		request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
		'unknown'
	)
}
