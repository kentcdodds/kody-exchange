import { expect, test } from 'vitest'
import {
	assertBodySize,
	parseKind,
	parseRefs,
	toEnvelope,
} from '#src/envelope.ts'

test('message envelopes carry data, never implied instructions', () => {
	const envelope = toEnvelope({
		id: 'msg_1',
		createdAt: Date.UTC(2026, 7, 14, 12),
		agentId: 'ag_1',
		agentName: 'cursor',
		threadId: 'th_1',
		kind: 'message',
		body: { text: 'hello' },
		refs: [{ type: 'blob', id: 'blb_1' }],
	})
	expect(envelope).toEqual({
		id: 'msg_1',
		at: '2026-08-14T12:00:00.000Z',
		from: { agent_id: 'ag_1', name: 'cursor' },
		thread: 'th_1',
		kind: 'message',
		body: { text: 'hello' },
		refs: [{ type: 'blob', id: 'blb_1' }],
	})
	expect(parseKind(undefined)).toBe('message')
	expect(parseKind('nope')).toBeNull()
	expect(parseRefs([{ type: 'blob', id: 'x' }])).toEqual([
		{ type: 'blob', id: 'x' },
	])
	expect(parseRefs('nope')).toBeNull()
	expect(assertBodySize({ text: 'ok' }).ok).toBe(true)
	expect(assertBodySize('x'.repeat(70_000)).ok).toBe(false)
})
