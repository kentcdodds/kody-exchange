import { expect, test } from 'vitest'
import {
	AGENT_ACCENT_COUNT,
	AGENT_ACCENT_DARK,
	AGENT_ACCENT_LIGHT,
	agentAccentCss,
	agentAccentIndex,
	agentAccentVar,
	contrastRatio,
	isMineBubble,
	mixHex,
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
