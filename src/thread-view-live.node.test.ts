import { expect, test } from 'vitest'
import { agentStatusIcon } from '#src/thread-view-chat.ts'
import {
	applyArchivedThreadView,
	isPinnedToBottom,
	nextPollDelayMs,
	THREAD_VIEW_ARCHIVED_CLOSE_REASON,
	THREAD_VIEW_ARCHIVED_INTRO,
	THREAD_VIEW_ARCHIVED_STAMP,
	threadViewArchivedPayload,
	threadViewLiveScript,
	VIEW_POLL_DEFAULT_SECONDS,
	VIEW_POLL_NEAR_BOTTOM_PX,
	type ArchivedViewRoot,
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
	expect(script).toContain('chat-item')
	expect(script).toContain('agent-avatar')
	expect(script).toContain('data-members')
	expect(script).toContain('Webhook · listening.')
	expect(script).toContain(JSON.stringify(agentStatusIcon('webhook')))
	expect(script).toContain(JSON.stringify(agentStatusIcon('polling')))
	expect(script).toContain(JSON.stringify(agentStatusIcon('none')))
	expect(script).not.toContain('M2 8c2-2.4')
	expect(script).not.toContain('M9.4 6A3.4')
	expect(script).toContain('data-receipts')
	expect(script).toContain('updateReceipts()')
	expect(script).toContain('return Math.abs(hash) % accentCount')
	expect(script).not.toContain('return Math.abs(hash32(key))')
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
	expect(script).toContain('applyArchivedView()')
	expect(script).toContain('data.archived')
	expect(script).toContain(
		`event.reason === ${JSON.stringify(THREAD_VIEW_ARCHIVED_CLOSE_REASON)}`,
	)
	expect(script).toContain(JSON.stringify(THREAD_VIEW_ARCHIVED_STAMP))
	expect(script).toContain(JSON.stringify(THREAD_VIEW_ARCHIVED_INTRO))
	expect(script).toContain('[data-thread-prompts]')
	expect(script).toContain('[data-archive-thread]')
	expect(script).toContain('[data-live-status]')
	expect(script).toContain("removeAttribute('data-poll')")
	expect(script).toContain("removeAttribute('data-live')")
	expect(script).toContain('stopped = true')
	expect(script).toContain('if (stopped) return')
	expect(script).toContain('liveSocket?.close()')
	expect(script).toContain('if (stopped || (!pollPath && !livePath)) return')
})

test('applyArchivedThreadView matches a freshly loaded archived page', () => {
	const stamp = { textContent: 'Read-only', remove() {}, removeAttribute() {} }
	const intro = {
		textContent: 'Copy the guest prompt to join an agent.',
		remove() {},
		removeAttribute() {},
	}
	const removed: Array<string> = []
	const attrs: Array<string> = []
	type ViewNode = NonNullable<ReturnType<ArchivedViewRoot['querySelector']>>
	const nodes = new Map<string, ViewNode>([
		['[data-stamp]', stamp],
		['[data-intro]', intro],
		[
			'[data-thread-prompts]',
			{
				textContent: null,
				remove() {
					removed.push('prompts')
				},
				removeAttribute() {},
			},
		],
		[
			'[data-archive-thread]',
			{
				textContent: null,
				remove() {
					removed.push('archive')
				},
				removeAttribute() {},
			},
		],
		[
			'[data-live-status]',
			{
				textContent: 'Live',
				remove() {
					removed.push('live')
				},
				removeAttribute() {},
			},
		],
		[
			'[data-chat]',
			{
				textContent: null,
				remove() {},
				removeAttribute(name: string) {
					attrs.push(name)
				},
			},
		],
	])
	applyArchivedThreadView({
		querySelector(selector: string) {
			return nodes.get(selector) ?? null
		},
	})
	expect(stamp.textContent).toBe(THREAD_VIEW_ARCHIVED_STAMP)
	expect(intro.textContent).toBe(THREAD_VIEW_ARCHIVED_INTRO)
	expect(removed).toEqual(['prompts', 'archive', 'live'])
	expect(attrs).toEqual(['data-poll', 'data-live'])
})

test('threadViewArchivedPayload tells the watch page to freeze', () => {
	expect(threadViewArchivedPayload()).toEqual({
		ok: true,
		archived: true,
		messages: [],
	})
})
