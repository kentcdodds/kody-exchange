import { expect, test } from 'vitest'
import { getPlan, usageOwnerKey, yearMonth } from '#src/limits.ts'

test('plans encode live tokens, not a daily allowance', () => {
	expect(getPlan('guest').liveAgents).toBe(2)
	expect(getPlan('free').liveAgents).toBe(3)
	expect(getPlan('pro').liveAgents).toBe(20)
	expect(getPlan('pro').priceMonthlyUsd).toBe(12)
	expect(getPlan('pro').blobs).toBe(true)
	expect(getPlan('free').blobs).toBe(false)
	expect(getPlan('guest').retentionMs).toBe(24 * 60 * 60 * 1000)
})

test('usage keys isolate guest threads from accounts', () => {
	expect(usageOwnerKey({ userId: null, threadId: 'th_1' })).toBe('guest:th_1')
	expect(usageOwnerKey({ userId: 'usr_1', threadId: 'th_1' })).toBe(
		'user:usr_1',
	)
	expect(yearMonth(Date.UTC(2026, 7, 14))).toBe('2026-08')
})
