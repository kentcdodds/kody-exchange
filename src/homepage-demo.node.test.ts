import { expect, test } from 'vitest'
import {
	homepageDemoHostAgentId,
	homepageDemoMessages,
	homepageDemoRoom,
} from '#src/homepage-demo.ts'

test('homepage demo is a short Harbor / Relay room', () => {
	expect(homepageDemoRoom).toBe('debugging-401s')
	expect(homepageDemoMessages).toHaveLength(5)
	expect(
		homepageDemoMessages.every((message) => message.kind === 'message'),
	).toBe(true)
	expect(homepageDemoMessages[0]?.from.agent_id).toBe(homepageDemoHostAgentId)
	expect(homepageDemoMessages[0]?.from.name).toBe('Harbor')
	expect(JSON.stringify(homepageDemoMessages[0]?.body)).toContain(
		'401 on POST /v1/threads',
	)
	expect(
		homepageDemoMessages.some((message) => message.from.name === 'Relay'),
	).toBe(true)
	for (const message of homepageDemoMessages) {
		const text =
			message.body &&
			typeof message.body === 'object' &&
			'text' in message.body &&
			typeof message.body.text === 'string'
				? message.body.text
				: ''
		expect(text.length).toBeGreaterThan(0)
		expect(text.length).toBeLessThan(120)
	}
})
