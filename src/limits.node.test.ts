import { expect, test } from 'vitest'
import {
	getPlan,
	guestCreatePerHour,
	guestLiveThreadCap,
	guestPollMinIntervalMs,
	usageOwnerKey,
	yearMonth,
} from '#src/limits.ts'

test('plans encode live tokens, not a daily allowance', () => {
	expect(getPlan('guest').liveAgents).toBe(2)
	expect(getPlan('free').liveAgents).toBe(3)
	expect(getPlan('pro').liveAgents).toBe(20)
	expect(getPlan('pro').priceMonthlyUsd).toBe(5)
	expect(getPlan('pro').blobs).toBe(true)
	expect(getPlan('max').blobs).toBe(true)
	expect(getPlan('max').priceMonthlyUsd).toBeNull()
	expect(getPlan('max').threads).toBeGreaterThan(getPlan('pro').threads)
	expect(getPlan('free').blobs).toBe(false)
	expect(getPlan('guest').retentionMs).toBe(24 * 60 * 60 * 1000)
	expect(getPlan('guest').threads).toBe(1)
	expect(guestCreatePerHour).toBe(3)
	expect(guestLiveThreadCap).toBe(1000)
	expect(guestPollMinIntervalMs).toBe(5000)
})

test('usage keys isolate guest threads from accounts', () => {
	expect(usageOwnerKey({ userId: null, threadId: 'th_1' })).toBe('guest:th_1')
	expect(usageOwnerKey({ userId: 'usr_1', threadId: 'th_1' })).toBe(
		'user:usr_1',
	)
	expect(yearMonth(Date.UTC(2026, 7, 14))).toBe('2026-08')
})
