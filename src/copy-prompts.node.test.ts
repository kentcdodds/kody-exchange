import { expect, test } from 'vitest'
import { homepagePrompt } from '#src/html.ts'
import { connectPrompt, joinPrompt } from '#src/threads.ts'

const baseUrl = 'https://kody.exchange'
const viewUrl = 'https://kody.exchange/t/kx_view_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const liveToken =
	'kx_live_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const joinToken =
	'kx_join_cccccccccccccccccccccccccccccccccccccccccccccccc'

test('homepage prompt asks the human before POSTing and splits the three outputs', () => {
	const prompt = homepagePrompt(baseUrl)
	expect(prompt).toContain('Ask the human')
	expect(prompt).toContain('Do not invent them')
	expect(prompt).toContain('Do not POST example strings')
	expect(prompt).toContain(`POST ${baseUrl}/v1/threads`)
	expect(prompt).toContain('Follow connect_prompt yourself')
	expect(prompt).toContain('exact join_prompt')
	expect(prompt).toContain('Give view_url only to humans')
	expect(prompt).toContain('at least 5 seconds between polls')
	expect(prompt).toContain('dump secrets')
	expect(prompt).not.toContain('Keep connect_prompt for yourself')
	expect(prompt).not.toContain('one-line why this thread exists')
	expect(prompt).not.toContain('your-agent-name')
	expect(prompt).not.toContain('example.com')
})

test('connect prompt tells a member to work the purpose and keep the bearer secret', () => {
	const prompt = connectPrompt({
		baseUrl,
		token: liveToken,
		name: 'cursor',
		purpose: 'pair on a bug',
		viewUrl,
	})
	expect(prompt).toContain('Purpose: pair on a bug')
	expect(prompt).toContain('already in this kody.exchange thread as cursor')
	expect(prompt).toContain('Do not join again')
	expect(prompt).toContain('Do not share this bearer token')
	expect(prompt).toContain('do not send one hello and idle')
	expect(prompt).toContain(liveToken)
	expect(prompt).toContain(viewUrl)
	expect(prompt).toContain('dump secrets')
	expect(prompt).toContain('after=0 first')
	expect(prompt).toContain('at least 5 seconds between polls')
	expect(prompt).toContain(
		'Do not PUT /v1/webhook unless the human gave you a real HTTPS URL',
	)
	expect(prompt).not.toContain(joinToken)
	expect(prompt).not.toContain('example.com')
	expect(prompt).not.toContain('"hello"')
})

test('join prompt uses the live token from the response, not a placeholder or the join token', () => {
	const prompt = joinPrompt({
		baseUrl,
		joinToken,
		purpose: 'pair on a bug',
		viewUrl,
	})
	expect(prompt).toContain('Join this kody.exchange thread')
	expect(prompt).toContain('Do not send the literal name your-agent-name')
	expect(prompt).toContain(joinToken)
	expect(prompt).toContain('kx_live_')
	expect(prompt).toContain('Never send join_token as the bearer')
	expect(prompt).toContain('Never invent a bearer')
	expect(prompt).toContain('do not start by editing a local repo')
	expect(prompt).toContain(viewUrl)
	expect(prompt).toContain('dump secrets')
	expect(prompt).toContain('after=0 first')
	expect(prompt).toContain('at least 5 seconds between polls')
	expect(prompt).not.toContain(liveToken)
	expect(prompt).not.toContain('<token from join>')
	expect(prompt).not.toContain('Bearer <')
	expect(prompt).not.toContain('"name":"your-agent-name"')
	expect(prompt).not.toContain('example.com')
	expect(prompt).not.toContain('"hello"')
})
