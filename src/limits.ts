export type PlanName = 'guest' | 'free' | 'pro'

export type PlanLimits = {
	name: PlanName
	label: string
	priceMonthlyUsd: number | null
	liveAgents: number
	threads: number
	messagesPerMonth: number
	retentionMs: number
	retentionLabel: string
	blobs: boolean
	blobBytes: number
	maxFileBytes: number
}

export const plans = {
	guest: {
		name: 'guest',
		label: 'Guest',
		priceMonthlyUsd: null,
		liveAgents: 2,
		threads: 1,
		messagesPerMonth: 50,
		retentionMs: 24 * 60 * 60 * 1000,
		retentionLabel: '24 hours',
		blobs: false,
		blobBytes: 0,
		maxFileBytes: 0,
	},
	free: {
		name: 'free',
		label: 'Free',
		priceMonthlyUsd: 0,
		liveAgents: 3,
		threads: 3,
		messagesPerMonth: 1000,
		retentionMs: 14 * 24 * 60 * 60 * 1000,
		retentionLabel: '14 days',
		blobs: false,
		blobBytes: 0,
		maxFileBytes: 0,
	},
	pro: {
		name: 'pro',
		label: 'Pro',
		priceMonthlyUsd: 12,
		liveAgents: 20,
		threads: 50,
		messagesPerMonth: 25_000,
		retentionMs: 90 * 24 * 60 * 60 * 1000,
		retentionLabel: '90 days',
		blobs: true,
		blobBytes: 1024 * 1024 * 1024,
		maxFileBytes: 25 * 1024 * 1024,
	},
} as const satisfies Record<PlanName, PlanLimits>

export function isPlanName(value: string): value is PlanName {
	return value === 'guest' || value === 'free' || value === 'pro'
}

export function getPlan(name: PlanName): PlanLimits {
	switch (name) {
		case 'guest':
			return plans.guest
		case 'free':
			return plans.free
		case 'pro':
			return plans.pro
		default: {
			const exhaustive: never = name
			throw new Error(`Unknown plan: ${String(exhaustive)}`)
		}
	}
}

export function yearMonth(now = Date.now()) {
	const date = new Date(now)
	const month = String(date.getUTCMonth() + 1).padStart(2, '0')
	return `${date.getUTCFullYear()}-${month}`
}

export function usageOwnerKey(input: {
	userId: string | null
	threadId: string
}) {
	return input.userId ? `user:${input.userId}` : `guest:${input.threadId}`
}

export const pollMinIntervalMs = 1000
export const pollRetryAfterSeconds = 2
export const guestCreatePerHour = 10
export const messageBurstPerMinute = 20
