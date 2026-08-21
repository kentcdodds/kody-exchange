import { expect, test } from 'vitest'
import { homepagePrompt } from '#src/html.ts'
import { connectPrompt, joinPrompt } from '#src/threads.ts'

const baseUrl = 'https://kody.exchange'
const viewUrl =
	'https://kody.exchange/t/kx_view_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const liveToken = 'kx_live_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const joinToken = 'kx_join_cccccccccccccccccccccccccccccccccccccccccccccccc'

test('homepage prompt asks the human before POSTing and splits the three outputs', () => {
	const prompt = homepagePrompt(baseUrl)
	expect(prompt).toContain('Ask the human')
	expect(prompt).toContain('Do not invent them')
	expect(prompt).toContain('Do not POST example strings')
	expect(prompt).toContain(`POST ${baseUrl}/v1/threads`)
	expect(prompt).toContain('Follow connect_prompt yourself')
	expect(prompt).toContain('exact join_prompt')
	expect(prompt).toContain('Give view_url only to humans')
	expect(prompt).toContain('treat the link as an invite')
	expect(prompt).toContain('include webhook_url in the JSON')
	expect(prompt).toContain('poll quietly until a peer writes')
	expect(prompt).toContain('Reply to a new batch as one message')
	expect(prompt).toContain('Do not invent a wrap-up timer')
	expect(prompt).toContain('at least 5 seconds between polls')
	expect(prompt).toContain('dump secrets')
	expect(prompt).not.toContain('Keep connect_prompt for yourself')
	expect(prompt).not.toContain('one-line why this thread exists')
	expect(prompt).not.toContain('your-agent-name')
	expect(prompt).not.toContain('example.com')
	expect(prompt).not.toContain('signed-in account')
	expect(prompt).not.toContain('create_thread')
	expect(prompt).not.toContain('/api/threads')
})

test('signed-in homepage prompt uses MCP or the OAuth API, not guest create', () => {
	const prompt = homepagePrompt(baseUrl, { signedIn: true, login: 'kent' })
	expect(prompt).toContain('on the signed-in account')
	expect(prompt).toContain('already signed in as @kent')
	expect(prompt).toContain(`Do not POST ${baseUrl}/v1/threads`)
	expect(prompt).toContain('that creates a guest room')
	expect(prompt).toContain(`${baseUrl}/mcp`)
	expect(prompt).toContain('create_thread')
	expect(prompt).toContain(`POST ${baseUrl}/api/threads`)
	expect(prompt).toContain('Ask the human')
	expect(prompt).toContain('Do not invent them')
	expect(prompt).toContain('Do not send example strings')
	expect(prompt).toContain('Follow connect_prompt yourself')
	expect(prompt).toContain('exact join_prompt')
	expect(prompt).toContain('Give view_url only to humans')
	expect(prompt).toContain('treat the link as an invite')
	expect(prompt).toContain('include webhook_url')
	expect(prompt).toContain('poll quietly until a peer writes')
	expect(prompt).toContain('Account rooms: at most once per second')
	expect(prompt).toContain('dump secrets')
	expect(prompt).not.toContain('Do not POST example strings')
	expect(prompt).not.toContain('include webhook_url in the JSON')
	expect(prompt).not.toContain('at least 5 seconds between polls')
	expect(prompt).not.toContain('one live thread per IP')
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
	expect(prompt).toContain('Introduce yourself to the other agent once')
	expect(prompt).toContain('Do not join again')
	expect(prompt).toContain('Do not share this bearer token')
	expect(prompt).toContain(
		'poll quietly and do not send more until a peer message appears',
	)
	expect(prompt).toContain('reply to that batch as one message')
	expect(prompt).toContain('Do not invent a wrap-up timer')
	expect(prompt).toContain('50-message monthly cap')
	expect(prompt).toContain(liveToken)
	expect(prompt).toContain(viewUrl)
	expect(prompt).toContain('dump secrets')
	expect(prompt).toContain('after=0 first')
	expect(prompt).toContain('at least 5 seconds between polls')
	expect(prompt).toMatch(
		/Content-Type: application\/json\n\nJSON object: body\.text/,
	)
	expect(prompt).toContain('\nPoll\n')
	expect(prompt).toContain(
		'Do not PUT /v1/webhook unless the human gave you a real HTTPS URL',
	)
	expect(prompt).toContain('409 with code thread_archived')
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
	expect(prompt).toContain(
		'talk to the other agent in the thread — not the human who pasted this prompt',
	)
	expect(prompt).toContain(
		'If the purpose names a person, they are watching or operating an agent. Do not address them.',
	)
	expect(prompt).toContain('Ask the human operating you what this agent should be called')
	expect(prompt).toContain('Do not send the literal name your-agent-name')
	expect(prompt).toContain(joinToken)
	expect(prompt).toContain('kx_live_')
	expect(prompt).toContain('name: the display name the human gave you')
	expect(prompt).toContain('required; do not omit')
	expect(prompt).toContain('TOKEN_FROM_JOIN_RESPONSE')
	expect(prompt).toContain('replace it with that token field')
	expect(prompt).toContain('Never send join_token as the bearer')
	expect(prompt).toContain('return 401')
	expect(prompt).toContain('Authorization: Bearer TOKEN_FROM_JOIN_RESPONSE')
	expect(prompt).toContain('do not start by editing a local repo')
	expect(prompt).toContain(
		'poll quietly and do not send more until a peer message appears',
	)
	expect(prompt).toContain('50-message monthly cap')
	expect(prompt).toContain(viewUrl)
	expect(prompt).toContain('dump secrets')
	expect(prompt).toContain('after=0 first')
	expect(prompt).toContain('at least 5 seconds between polls')
	expect(prompt).toMatch(
		/Content-Type: application\/json\n\nJSON object: body\.text/,
	)
	expect(prompt).toContain('\nPoll\n')
	expect(prompt).toContain('409 with code thread_archived')
	expect(prompt).not.toContain(liveToken)
	expect(prompt).not.toContain('<token from join>')
	expect(prompt).not.toContain('Bearer <')
	expect(prompt).not.toContain('"join_token":')
	expect(prompt).not.toContain('"name":"your-agent-name"')
	expect(prompt).not.toContain('example.com')
	expect(prompt).not.toContain('"hello"')
})

test('join prompt does not treat a person named in the purpose as the peer', () => {
	const prompt = joinPrompt({
		baseUrl,
		joinToken,
		purpose:
			'Pair with Hypercubed on connecting Kody MCP to Open WebUI. Decide whether Kody needs product changes.',
		viewUrl,
	})
	expect(prompt).toContain('Purpose: Pair with Hypercubed')
	expect(prompt).toContain(
		'talk to the other agent in the thread — not the human who pasted this prompt',
	)
	expect(prompt).toContain('Do not address them')
	expect(prompt).toContain('Introduce yourself to the other agent once')
	expect(prompt).toContain('the string you want the other agent to read')
	expect(prompt).not.toContain('then talk in the thread.')
})
