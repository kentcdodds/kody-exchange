import { expect, test } from 'vitest'
import {
	AGENT_ACCENT_COUNT,
	AGENT_ACCENT_DARK,
	AGENT_ACCENT_LIGHT,
	agentAccentCss,
	agentAccentIndex,
	agentAccentVar,
	hash32,
	agentAvatarSvg,
	agentIdenticonCells,
	agentPresence,
	contrastRatio,
	isMineBubble,
	mixHex,
	receiptLabel,
	receiptMembers,
} from '#src/thread-view-chat.ts'

const lightCard = '#fffaf1'
const lightInk = '#1c1610'
const lightMuted = '#6b5e4e'
const darkCard = '#241e18'
const darkInk = '#f3eadc'
const darkMuted = '#b5a894'

test('agent accents are stable indexes into the shared palette', () => {
	expect(agentAccentIndex('ag_host')).toBe(agentAccentIndex('ag_host'))
	expect(agentAccentIndex('ag_host')).toBeLessThan(AGENT_ACCENT_COUNT)
	expect(agentAccentVar(0)).toBe('var(--agent-0)')
	expect(agentAccentVar(7)).toBe('var(--agent-2)')
	const indexes = new Set(
		['cursor', 'claude', 'host', 'guest', 'codex'].map(agentAccentIndex),
	)
	expect(indexes.size).toBeGreaterThan(1)
	expect(agentAccentCss()).toContain('--agent-0:')
	expect(agentAccentCss()).toContain('prefers-color-scheme: dark')
})

test('agent accents meet WCAG contrast in light and dark', () => {
	expect(AGENT_ACCENT_LIGHT).toHaveLength(AGENT_ACCENT_COUNT)
	expect(AGENT_ACCENT_DARK).toHaveLength(AGENT_ACCENT_COUNT)
	for (const color of AGENT_ACCENT_LIGHT) {
		expect(contrastRatio(color, lightCard)).toBeGreaterThanOrEqual(3)
		const wash = mixHex(lightCard, color, 0.1)
		expect(contrastRatio(lightInk, wash)).toBeGreaterThanOrEqual(4.5)
		expect(contrastRatio(lightMuted, wash)).toBeGreaterThanOrEqual(4.5)
	}
	for (const color of AGENT_ACCENT_DARK) {
		expect(contrastRatio(color, darkCard)).toBeGreaterThanOrEqual(3)
		const wash = mixHex(darkCard, color, 0.1)
		expect(contrastRatio(darkInk, wash)).toBeGreaterThanOrEqual(4.5)
		expect(contrastRatio(darkMuted, wash)).toBeGreaterThanOrEqual(4.5)
	}
})

test('host viewer pins host messages to the right', () => {
	expect(
		isMineBubble({
			kind: 'message',
			agentId: 'ag_host',
			hostAgentId: 'ag_host',
			viewer: 'host',
		}),
	).toBe(true)
	expect(
		isMineBubble({
			kind: 'message',
			agentId: 'ag_guest',
			hostAgentId: 'ag_host',
			viewer: 'host',
		}),
	).toBe(false)
})

test('guest viewer pins non-host messages to the right', () => {
	expect(
		isMineBubble({
			kind: 'message',
			agentId: 'ag_guest',
			hostAgentId: 'ag_host',
			viewer: 'guest',
		}),
	).toBe(true)
	expect(
		isMineBubble({
			kind: 'message',
			agentId: 'ag_host',
			hostAgentId: 'ag_host',
			viewer: 'guest',
		}),
	).toBe(false)
})

test('system bubbles are never mine', () => {
	expect(
		isMineBubble({
			kind: 'system',
			agentId: 'ag_host',
			hostAgentId: 'ag_host',
			viewer: 'host',
		}),
	).toBe(false)
})

test('accent index stays on the signed djb2 used by the live script', () => {
	const key = 'ag_guest'
	let signed = 5381
	for (const character of key) signed = (signed * 33) ^ character.charCodeAt(0)
	expect(signed).toBeLessThan(0)
	expect(hash32(key)).toBeGreaterThan(0x7fff_ffff)
	expect(agentAccentIndex(key)).toBe(Math.abs(signed) % AGENT_ACCENT_COUNT)
	expect(agentAccentIndex(key)).not.toBe(hash32(key) % AGENT_ACCENT_COUNT)
})

test('generated avatars are stable identicons', () => {
	expect(agentAvatarSvg('ag_host')).toBe(agentAvatarSvg('ag_host'))
	expect(agentAvatarSvg('ag_host')).not.toBe(agentAvatarSvg('ag_guest'))
	expect(agentAvatarSvg('ag_host')).toContain('class="agent-face"')
	expect(
		agentIdenticonCells('ag_host').flat().filter(Boolean).length,
	).toBeGreaterThanOrEqual(3)
})

test('presence prefers webhook over polling and times out polls', () => {
	const now = Date.parse('2026-08-26T12:00:00.000Z')
	expect(agentPresence({ webhook: true, last_poll_at: null }, now)).toEqual({
		online: true,
		connection: 'webhook',
		label: 'Webhook · listening.',
	})
	expect(
		agentPresence(
			{ webhook: true, last_poll_at: '2026-08-26T11:59:50.000Z' },
			now,
		).label,
	).toContain('Last polled 2026-08-26T11:59:50.000Z')
	expect(
		agentPresence(
			{ webhook: false, last_poll_at: '2026-08-26T11:59:50.000Z' },
			now,
		),
	).toMatchObject({ online: true, connection: 'polling' })
	expect(
		agentPresence(
			{ webhook: false, last_poll_at: '2026-08-26T11:58:00.000Z' },
			now,
		),
	).toMatchObject({ online: false, connection: 'polling' })
	expect(agentPresence({ webhook: false, last_poll_at: null }, now)).toEqual({
		online: false,
		connection: 'none',
		label: 'Has not connected yet.',
	})
})

test('read receipts skip the sender and unread peers', () => {
	const message = {
		id: 'msg_2',
		at: '2026-08-26T12:00:10.000Z',
		kind: 'message',
		from: { agent_id: 'ag_host' },
	}
	const host = {
		id: 'ag_host',
		name: 'harbor',
		last_seen_message_id: 'msg_2',
		last_seen_at: '2026-08-26T12:00:10.000Z',
		last_seen_via: 'send' as const,
	}
	const guest = {
		id: 'ag_guest',
		name: 'relay',
		last_seen_message_id: 'msg_2',
		last_seen_at: '2026-08-26T12:00:10.000Z',
		last_seen_via: 'webhook' as const,
	}
	const unread = {
		id: 'ag_late',
		name: 'late',
		last_seen_message_id: 'msg_1',
		last_seen_at: '2026-08-26T12:00:00.000Z',
		last_seen_via: 'poll' as const,
	}
	expect(receiptMembers(message, [host, guest, unread])).toEqual([guest])
	expect(receiptLabel(guest)).toBe('Seen by relay via webhook')
	expect(receiptMembers({ ...message, kind: 'system' }, [host, guest])).toEqual(
		[],
	)
})
