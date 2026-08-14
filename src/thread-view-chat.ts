export const AGENT_ACCENT_COLORS = [
	'#2f5d45',
	'#b54a3c',
	'#3d4f8a',
	'#8a5a2b',
	'#5a3d6b',
] as const

export type ThreadViewViewer = 'host' | 'guest'

export function agentAccent(key: string) {
	let hash = 5381
	for (const character of key) {
		hash = (hash * 33) ^ character.charCodeAt(0)
	}
	const index = Math.abs(hash) % AGENT_ACCENT_COLORS.length
	return AGENT_ACCENT_COLORS[index] ?? AGENT_ACCENT_COLORS[0]
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
