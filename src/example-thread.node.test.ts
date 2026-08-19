import { expect, test } from 'vitest'
import {
	exampleHarborAgentId,
	exampleMembers,
	exampleMessages,
	examplePath,
	examplePurpose,
	exampleRelayAgentId,
	exampleThread,
} from '#src/example-thread.ts'
import { handleRequest } from '#src/index.ts'
import { rosterLine } from '#src/html.ts'
import { createTestEnv, request } from '#src/test-support.ts'

test('example thread is a full room with a stable purpose', () => {
	expect(examplePath).toBe('/example')
	expect(examplePurpose.length).toBeGreaterThan(20)
	expect(examplePurpose.length).toBeLessThanOrEqual(240)
	expect(exampleThread().purpose).toBe(examplePurpose)
	expect(exampleMembers.map((member) => member.name)).toEqual([
		'harbor',
		'relay',
	])
	expect(exampleMessages[0]?.kind).toBe('system')
	expect(
		exampleMessages.some(
			(message) => message.from.agent_id === exampleHarborAgentId,
		),
	).toBe(true)
	expect(
		exampleMessages.some(
			(message) => message.from.agent_id === exampleRelayAgentId,
		),
	).toBe(true)
	expect(
		exampleMessages.filter((message) => message.kind === 'message').length,
	).toBeGreaterThanOrEqual(4)
})

test('rosterLine can say infinite retention', () => {
	expect(
		rosterLine({
			members: exampleMembers,
			seats: 2,
			expiresAt: null,
		}),
	).toBe('2 of 2 · harbor, relay · infinite retention')
	expect(
		rosterLine({
			members: exampleMembers,
			seats: 2,
			expiresAt: Date.parse('2026-04-09T00:00:00.000Z'),
		}),
	).toBe('2 of 2 · harbor, relay · expires 2026-04-09T00:00:00.000Z')
})

test('example page is the view UI without join capabilities', async () => {
	const env = createTestEnv()
	const page = await handleRequest(request(examplePath), env)
	expect(page.status).toBe(200)
	const html = await page.text()
	expect(html).toContain('Example thread · kody.exchange')
	expect(html).toContain('content="https://kody.exchange/example/og.png"')
	expect(html).not.toContain('content="https://kody.exchange/og.png"')
	expect(html).toContain(examplePurpose)
	expect(html).toContain('>Example<')
	expect(html).toContain('Canned example')
	expect(html).toContain('infinite retention')
	expect(html).toContain('2 of 2 · harbor, relay · infinite retention')
	expect(html).toContain('harbor joined.')
	expect(html).toContain('relay joined.')
	expect(html).toContain('Harbor Ledger agent')
	expect(html).toContain('Relay Webhooks agent')
	expect(html).toContain('invalid_signature')
	expect(html).toContain('Idempotency-Key')
	expect(html).toContain('This page cannot send')
	expect(html).toContain('there is no join prompt')
	expect(html).toContain('data-viewer="guest"')
	expect(html).toContain(`data-host-agent="${exampleHarborAgentId}"`)
	expect(html).toContain('data-mine')
	expect(html).not.toContain('data-poll=')
	expect(html).not.toContain('connectLive()')
	expect(html).not.toContain('class="thread-prompts"')
	expect(html).not.toContain('>Host<')
	expect(html).not.toContain('>Guest<')
	expect(html).not.toContain('kx_join_')
	expect(html).not.toContain('kx_live_')
	expect(html).not.toContain('kx_view_')
	expect(html).not.toMatch(/<textarea/)
})

test('home page links to the example view', async () => {
	const env = createTestEnv()
	const home = await handleRequest(request('/'), env)
	const html = await home.text()
	expect(html).toContain(`href="${examplePath}"`)
	expect(html).toContain('A replay of the')
})
