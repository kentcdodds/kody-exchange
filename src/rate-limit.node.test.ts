import { expect, test } from 'vitest'
import { createTestEnv } from '#src/test-support.ts'
import {
	limitGuestCreates,
	limitPoll,
	limitViewPoll,
	type PollCache,
	type RateLimitStore,
} from '#src/rate-limit.ts'

class MemoryPollCache implements PollCache {
	#until = new Map<string, number>()

	async match(request: RequestInfo | URL) {
		const url = request instanceof Request ? request.url : String(request)
		const expires = this.#until.get(url)
		if (expires && expires > Date.now()) return new Response('1')
		return undefined
	}

	async put(request: RequestInfo | URL, response: Response) {
		const url = request instanceof Request ? request.url : String(request)
		const maxAge = Number(
			/max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1] ??
				0,
		)
		this.#until.set(url, Date.now() + maxAge * 1000)
	}
}

function countingStore(inner: RateLimitStore) {
	let puts = 0
	return {
		puts: () => puts,
		store: {
			get: (key: string) => inner.get(key),
			put: async (
				key: string,
				value: string,
				options?: KVNamespacePutOptions,
			) => {
				puts += 1
				await inner.put(key, value, options)
			},
		} as RateLimitStore,
	}
}

test('guest creates stop at three per IP per hour', async () => {
	const env = createTestEnv()
	const now = Date.parse('2026-08-14T00:00:00Z')
	for (let index = 0; index < 3; index += 1) {
		const allowed = await limitGuestCreates({
			store: env.RATE_LIMIT,
			ip: '203.0.113.4',
			now,
		})
		expect(allowed.ok).toBe(true)
	}
	const blocked = await limitGuestCreates({
		store: env.RATE_LIMIT,
		ip: '203.0.113.4',
		now,
	})
	expect(blocked).toMatchObject({ ok: false, retryAfterSeconds: 3600 })
})

test('poll cache rejects inside the window without another KV write', async () => {
	const env = createTestEnv()
	const counted = countingStore(env.RATE_LIMIT)
	const cache = new MemoryPollCache()
	const first = await limitPoll({
		store: counted.store,
		cache,
		agentId: 'ag_1',
		threadId: 'th_1',
		minIntervalMs: 5000,
		persistEveryMs: 30_000,
		now: 1_000,
	})
	expect(first.ok).toBe(true)
	expect(counted.puts()).toBe(1)

	const tooSoon = await limitPoll({
		store: counted.store,
		cache,
		agentId: 'ag_1',
		threadId: 'th_1',
		minIntervalMs: 5000,
		persistEveryMs: 30_000,
		now: 2_000,
	})
	expect(tooSoon).toMatchObject({ ok: false, retryAfterSeconds: 5 })
	expect(counted.puts()).toBe(1)
})

test('allowed polls persist KV at most every persistEveryMs when cache is on', async () => {
	const env = createTestEnv()
	const counted = countingStore(env.RATE_LIMIT)
	const cache = new MemoryPollCache()
	const first = await limitPoll({
		store: counted.store,
		cache,
		agentId: 'ag_1',
		threadId: 'th_1',
		minIntervalMs: 1000,
		persistEveryMs: 30_000,
		now: 10_000,
	})
	expect(first.ok).toBe(true)

	const later = await limitViewPoll({
		store: counted.store,
		cache,
		ip: '203.0.113.4',
		threadId: 'th_1',
		minIntervalMs: 5000,
		persistEveryMs: 30_000,
		now: 10_000,
	})
	expect(later.ok).toBe(true)
	expect(counted.puts()).toBe(2)

	const secondPoll = await limitPoll({
		store: counted.store,
		cache: new MemoryPollCache(),
		agentId: 'ag_1',
		threadId: 'th_1',
		minIntervalMs: 1000,
		persistEveryMs: 30_000,
		now: 12_000,
	})
	expect(secondPoll.ok).toBe(true)
	expect(counted.puts()).toBe(2)
})
