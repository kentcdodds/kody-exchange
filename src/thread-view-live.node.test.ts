import { expect, test } from 'vitest'
import {
	isPinnedToBottom,
	nextPollDelayMs,
	threadViewLiveScript,
	VIEW_POLL_DEFAULT_SECONDS,
	VIEW_POLL_NEAR_BOTTOM_PX,
} from '#src/thread-view-live.ts'

test('isPinnedToBottom is true at or near the bottom', () => {
	expect(
		isPinnedToBottom({
			scrollTop: 1000,
			clientHeight: 400,
			scrollHeight: 1400,
		}),
	).toBe(true)
	expect(
		isPinnedToBottom({
			scrollTop: 1400 - 400 - VIEW_POLL_NEAR_BOTTOM_PX,
			clientHeight: 400,
			scrollHeight: 1400,
		}),
	).toBe(true)
	expect(
		isPinnedToBottom({
			scrollTop: 1400 - 400 - VIEW_POLL_NEAR_BOTTOM_PX - 1,
			clientHeight: 400,
			scrollHeight: 1400,
		}),
	).toBe(false)
})

test('isPinnedToBottom is true when the pane does not overflow', () => {
	expect(
		isPinnedToBottom({ scrollTop: 0, clientHeight: 400, scrollHeight: 200 }),
	).toBe(true)
})

test('nextPollDelayMs prefers retry_after, then Retry-After, then 5s', () => {
	expect(nextPollDelayMs({ retryAfterSeconds: 5 })).toBe(5000)
	expect(nextPollDelayMs({ retryAfterSeconds: 1.2 })).toBe(2000)
	expect(nextPollDelayMs({ retryAfterHeader: '3' })).toBe(3000)
	expect(nextPollDelayMs({ retryAfterSeconds: 7, retryAfterHeader: '3' })).toBe(
		7000,
	)
	expect(nextPollDelayMs()).toBe(VIEW_POLL_DEFAULT_SECONDS * 1000)
	expect(
		nextPollDelayMs({ retryAfterSeconds: 0, retryAfterHeader: 'nope' }),
	).toBe(5000)
})

test('live script prefers a socket and pins when already at the bottom', () => {
	const script = threadViewLiveScript()
	expect(script).toContain('connectLive()')
	expect(script).toContain('new WebSocket')
	expect(script).toContain('pinToBottom()')
	expect(script).toContain('isPinnedToBottom()')
	expect(script).toContain(`const nearBottomPx = ${VIEW_POLL_NEAR_BOTTOM_PX}`)
	expect(script).toContain('retry-after')
	expect(script).toContain('isMineBubble')
	expect(script).toContain('dataset.mine')
	expect(script).toContain('--agent-')
	expect(script).toContain("setLiveLabel('Live')")
	expect(script).toContain('void tick()')
	expect(script).toContain('pollGeneration')
	expect(script).toContain('infinite retention')
	expect(script).toContain("expiresRaw === 'infinite'")
	expect(script).toContain('generation !== pollGeneration')
	expect(
		script.match(/generation !== pollGeneration/g)?.length,
	).toBeGreaterThanOrEqual(3)
	expect(script).not.toContain('if (socketOpen) return')
	expect(script).not.toContain('window.setTimeout(tick, 5000)')
	expect(script).toContain('response.status === 409')
	expect(script).toContain("stopLive('Archived')")
	expect(script).toContain('stopped = true')
	expect(script).toContain('if (stopped) return')
	expect(script).toContain('liveSocket?.close()')
	expect(script).toContain('if (stopped || (!pollPath && !livePath)) return')
})
