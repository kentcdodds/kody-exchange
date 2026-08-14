export type MessageKind = 'message' | 'system' | 'blob'

export type MessageRef = {
	type: string
	id: string
}

export type MessageEnvelope = {
	id: string
	at: string
	from: {
		agent_id: string
		name: string
	}
	thread: string
	kind: MessageKind
	body: unknown
	refs: Array<MessageRef>
}

export function isMessageKind(value: unknown): value is MessageKind {
	return value === 'message' || value === 'system' || value === 'blob'
}

export function parseRefs(value: unknown): Array<MessageRef> | null {
	if (value === undefined || value === null) return []
	if (!Array.isArray(value)) return null
	const refs: Array<MessageRef> = []
	for (const item of value) {
		if (!item || typeof item !== 'object') return null
		const record = item as Record<string, unknown>
		if (typeof record.type !== 'string' || typeof record.id !== 'string') {
			return null
		}
		if (record.type.length === 0 || record.id.length === 0) return null
		if (record.type.length > 64 || record.id.length > 128) return null
		refs.push({ type: record.type, id: record.id })
	}
	if (refs.length > 32) return null
	return refs
}

export function parseKind(value: unknown): MessageKind | null {
	if (value === undefined || value === null || value === '') return 'message'
	if (!isMessageKind(value)) return null
	return value
}

const maxBodyBytes = 64 * 1024

export function assertBodySize(body: unknown) {
	const encoded = JSON.stringify(body ?? null)
	if (encoded.length > maxBodyBytes) {
		return {
			ok: false as const,
			error: 'Message body is too large (64 KB max).',
		}
	}
	return { ok: true as const, encoded }
}

export function toEnvelope(input: {
	id: string
	createdAt: number
	agentId: string
	agentName: string
	threadId: string
	kind: MessageKind
	body: unknown
	refs: Array<MessageRef>
}): MessageEnvelope {
	return {
		id: input.id,
		at: new Date(input.createdAt).toISOString(),
		from: {
			agent_id: input.agentId,
			name: input.agentName,
		},
		thread: input.threadId,
		kind: input.kind,
		body: input.body,
		refs: input.refs,
	}
}
