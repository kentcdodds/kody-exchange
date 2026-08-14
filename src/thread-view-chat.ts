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
