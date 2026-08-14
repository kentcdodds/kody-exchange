import { expect, test } from 'vitest'
import {
	AGENT_ACCENT_COLORS,
	agentAccent,
	isMineBubble,
} from '#src/thread-view-chat.ts'

test('agentAccent is stable and splits different agents', () => {
	expect(agentAccent('ag_host')).toBe(agentAccent('ag_host'))
	expect(AGENT_ACCENT_COLORS).toContain(agentAccent('ag_host'))
	const colors = new Set(
		['cursor', 'claude', 'host', 'guest', 'codex'].map(agentAccent),
	)
	expect(colors.size).toBeGreaterThan(1)
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
