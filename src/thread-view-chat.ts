export const AGENT_ACCENT_COUNT = 5

export const AGENT_ACCENT_LIGHT = [
	'#2f5d45',
	'#9a3a30',
	'#33457a',
	'#7a4e24',
	'#4e3460',
] as const

export const AGENT_ACCENT_DARK = [
	'#7dba90',
	'#e08a7c',
	'#9eb0dc',
	'#d4a574',
	'#c4a0d4',
] as const

export type ThreadViewViewer = 'host' | 'guest'

export function agentAccentIndex(key: string) {
	let hash = 5381
	for (const character of key) {
		hash = (hash * 33) ^ character.charCodeAt(0)
	}
	return Math.abs(hash) % AGENT_ACCENT_COUNT
}

export function agentAccentVar(index: number) {
	const safe =
		((index % AGENT_ACCENT_COUNT) + AGENT_ACCENT_COUNT) % AGENT_ACCENT_COUNT
	return `var(--agent-${safe})`
}

export function isMineBubble(input: {
	kind: string
	agentId: string
	hostAgentId: string | null
	viewer: ThreadViewViewer
}) {
	if (input.kind === 'system') return false
	if (!input.hostAgentId) return false
	const fromHost = input.agentId === input.hostAgentId
	return input.viewer === 'host' ? fromHost : !fromHost
}

export function agentAccentCss() {
	const light = AGENT_ACCENT_LIGHT.map(
		(color, index) => `--agent-${index}: ${color};`,
	).join(' ')
	const dark = AGENT_ACCENT_DARK.map(
		(color, index) => `--agent-${index}: ${color};`,
	).join(' ')
	return `:root { ${light} }
@media (prefers-color-scheme: dark) {
	:root { ${dark} }
}`
}

export function relativeLuminance(hex: string) {
	const value = Number.parseInt(hex.slice(1), 16)
	const channel = (shift: number) => {
		const part = ((value >> shift) & 255) / 255
		return part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4
	}
	return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0)
}

export function contrastRatio(left: string, right: string) {
	const [bright, dim] = [
		relativeLuminance(left),
		relativeLuminance(right),
	].toSorted((a, b) => b - a)
	return ((bright ?? 0) + 0.05) / ((dim ?? 0) + 0.05)
}

function parseHex(hex: string) {
	const value = Number.parseInt(hex.slice(1), 16)
	return [(value >> 16) & 255, (value >> 8) & 255, value & 255] as const
}

export function mixHex(base: string, tint: string, amount: number) {
	const [br, bg, bb] = parseHex(base)
	const [tr, tg, tb] = parseHex(tint)
	const mix = (from: number, to: number) =>
		Math.round(from * (1 - amount) + to * amount)
	return `#${[mix(br, tr), mix(bg, tg), mix(bb, tb)]
		.map((part) => part.toString(16).padStart(2, '0'))
		.join('')}`
}

export const AGENT_ONLINE_POLL_MS = 60_000
export const AGENT_IDENTICON_SIZE = 32
export const AGENT_IDENTICON_CELLS = 5
export const AGENT_IDENTICON_UNIQUE_COLS = 3

function pluralAge(count: number, unit: string) {
	return `${count} ${unit}${count === 1 ? '' : 's'} ago`
}

export function formatPollAge(iso: string, now = Date.now()) {
	const then = Date.parse(iso)
	if (!Number.isFinite(then)) return iso
	const seconds = Math.max(0, Math.floor((now - then) / 1000))
	if (seconds < 10) return 'just now'
	if (seconds < 60) return pluralAge(seconds, 'second')
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return pluralAge(minutes, 'minute')
	const hours = Math.floor(minutes / 60)
	if (hours < 24) return pluralAge(hours, 'hour')
	const days = Math.floor(hours / 24)
	if (days < 30) return pluralAge(days, 'day')
	const months = Math.floor(days / 30)
	if (months < 12) return pluralAge(months, 'month')
	return pluralAge(Math.floor(days / 365), 'year')
}

export type AgentLastSeenVia = 'poll' | 'webhook' | 'send'
export type AgentConnectionKind = 'webhook' | 'polling' | 'none'

export type AgentPresenceMember = {
	webhook: boolean
	last_poll_at: string | null
}

export type AgentPresence = {
	online: boolean
	connection: AgentConnectionKind
	label: string
}

export type AgentReceiptMember = {
	id: string
	name: string
	last_seen_message_id: string | null
	last_seen_at: string | null
	last_seen_via: AgentLastSeenVia | null
}

export function hash32(key: string) {
	let hash = 5381
	for (const character of key) {
		hash = (hash * 33) ^ character.charCodeAt(0)
	}
	return hash >>> 0
}

export function agentIdenticonCells(key: string) {
	const first = hash32(key)
	const second = hash32(`${key}#`)
	const rows: Array<Array<boolean>> = []
	for (let row = 0; row < AGENT_IDENTICON_CELLS; row += 1) {
		const cols: Array<boolean> = []
		for (let col = 0; col < AGENT_IDENTICON_UNIQUE_COLS; col += 1) {
			const bit = row * AGENT_IDENTICON_UNIQUE_COLS + col
			const source = bit < 16 ? first : second
			const shift = bit < 16 ? bit : bit - 16
			cols.push(((source >>> shift) & 1) === 1)
		}
		rows.push(cols)
	}
	const filled = rows.flat().filter(Boolean).length
	if (filled < 3) {
		const center = rows[2]
		const upper = rows[1]
		const lower = rows[3]
		if (center) center[1] = true
		if (upper) upper[0] = true
		if (lower) lower[0] = true
	}
	return rows
}

export function agentAvatarSvg(key: string) {
	const cells = agentIdenticonCells(key)
	const cell = 4
	const pad = 6
	const rects: Array<string> = []
	for (let row = 0; row < AGENT_IDENTICON_CELLS; row += 1) {
		for (let col = 0; col < AGENT_IDENTICON_CELLS; col += 1) {
			const sourceCol = col < AGENT_IDENTICON_UNIQUE_COLS ? col : 4 - col
			if (!cells[row]?.[sourceCol]) continue
			rects.push(
				`<rect x="${pad + col * cell}" y="${pad + row * cell}" width="${cell}" height="${cell}" />`,
			)
		}
	}
	return `<svg class="agent-face" viewBox="0 0 ${AGENT_IDENTICON_SIZE} ${AGENT_IDENTICON_SIZE}" aria-hidden="true"><circle class="agent-face-bg" cx="16" cy="16" r="16" /><g class="agent-face-cells">${rects.join('')}</g></svg>`
}

function statusBadgeSvg(inner: string) {
	return `<svg viewBox="0 0 16 16" aria-hidden="true">${inner}</svg>`
}

export function agentStatusIcon(connection: AgentConnectionKind) {
	switch (connection) {
		case 'webhook':
			// Chunky bolt, nudged +0.55x so the zigzag's visual mass sits on center.
			return statusBadgeSvg(
				'<path fill="currentColor" d="M9.45 2.15 5.1 8.55h2.9L7.55 13.85 11.9 7.45H9Z"/>',
			)
		case 'polling':
			// Thick clock around (8,8): timed checks. Short hands keep the mass centered.
			return statusBadgeSvg(
				'<circle cx="8" cy="8" r="5.7" fill="none" stroke="currentColor" stroke-width="2.15"/><path d="M8 5.15v3.05l1.7 1.05" fill="none" stroke="currentColor" stroke-width="2.15" stroke-linecap="round" stroke-linejoin="round"/>',
			)
		case 'none':
			return statusBadgeSvg(
				'<circle cx="8" cy="8" r="3.6" fill="none" stroke="currentColor" stroke-width="2.15"/>',
			)
		default: {
			const exhaustive: never = connection
			return exhaustive
		}
	}
}

export function agentPresence(
	member: AgentPresenceMember,
	now = Date.now(),
): AgentPresence {
	if (member.webhook) {
		const poll = member.last_poll_at
			? ` Last polled ${formatPollAge(member.last_poll_at, now)}.`
			: ''
		return {
			online: true,
			connection: 'webhook',
			label: `Webhook · listening.${poll}`,
		}
	}
	if (member.last_poll_at) {
		const last = Date.parse(member.last_poll_at)
		const online = Number.isFinite(last) && now - last <= AGENT_ONLINE_POLL_MS
		const age = formatPollAge(member.last_poll_at, now)
		return {
			online,
			connection: 'polling',
			label: online
				? `Polling · last polled ${age}.`
				: `Offline · last polled ${age}.`,
		}
	}
	return {
		online: false,
		connection: 'none',
		label: 'Has not connected yet.',
	}
}

export function messageIsSeenBy(
	message: { id: string; at: string },
	member: Pick<AgentReceiptMember, 'last_seen_message_id' | 'last_seen_at'>,
) {
	if (!member.last_seen_at || !member.last_seen_message_id) return false
	if (message.at < member.last_seen_at) return true
	if (message.at > member.last_seen_at) return false
	return message.id <= member.last_seen_message_id
}

export function receiptMembers<T extends AgentReceiptMember>(
	message: { id: string; at: string; kind: string; from: { agent_id: string } },
	members: Array<T>,
) {
	if (message.kind !== 'message') return []
	return members.filter(
		(member) =>
			member.id !== message.from.agent_id && messageIsSeenBy(message, member),
	)
}

export function receiptLabel(member: AgentReceiptMember) {
	switch (member.last_seen_via) {
		case 'webhook':
			return `Seen by ${member.name} via webhook`
		case 'poll':
			return `Seen by ${member.name} via poll`
		case 'send':
		case null:
			return `Seen by ${member.name}`
		default: {
			const exhaustive: never = member.last_seen_via
			return exhaustive
		}
	}
}
