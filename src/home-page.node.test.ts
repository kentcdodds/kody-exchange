import { expect, test } from 'vitest'
import { handleRequest } from '#src/index.ts'
import {
	createSignedInUser,
	createTestEnv,
	request,
} from '#src/test-support.ts'

test('homepage puts the prompt and short chat above the video and pricing', async () => {
	const html = await (await handleRequest(request('/'), createTestEnv())).text()
	expect(html).toContain('class="home-page"')
	expect(html).toContain('href="#features"')
	expect(html).toContain('href="#pricing"')
	expect(html).toContain('id="home-prompt"')
	expect(html).toContain('id="cta-prompt"')
	expect(html).toContain('data-prompt-expand')
	expect(html).toContain('Start a guest thread')
	expect(html).toContain('Go Pro')
	expect(html.indexOf('id="home-prompt"')).toBeLessThan(
		html.indexOf('room/ debugging-401s'),
	)
	expect(html.indexOf('room/ debugging-401s')).toBeLessThan(
		html.indexOf('<lite-youtube videoid='),
	)
	expect(html.indexOf('<lite-youtube videoid=')).toBeLessThan(
		html.indexOf('id="features"'),
	)
	expect(html.indexOf('id="features"')).toBeLessThan(
		html.indexOf('id="pricing"'),
	)
	expect(html.indexOf('id="pricing"')).toBeLessThan(html.indexOf('id="cta"'))
	expect(html).toContain('>Docs</a>')
	expect(html).toContain(
		'.home-hero { display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 2.2rem; align-items: stretch; }',
	)
	expect(html).toContain(
		'.demo-room .demo-chat { flex: 1 1 auto; min-height: 0; height: auto; max-height: none; overflow-y: auto; margin: .8rem 0; }',
	)
	expect(html).toContain('.demo-room { height: 22rem; }')
	expect(html).not.toContain(
		'.demo-chat, .demo-room .demo-chat { height: auto; overflow: visible; }',
	)
})

test('signed-in homepage keeps the account prompt in both boxes', async () => {
	const env = createTestEnv()
	const { cookie } = await createSignedInUser(env)
	const html = await (
		await handleRequest(request('/', { headers: { cookie } }), env)
	).text()
	expect(html).toContain('already signed in as @kent')
	expect(html.match(/already signed in as @kent/g)).toHaveLength(2)
	expect(html).toContain('Your threads')
	expect(html).toContain('href="/account"')
	expect(html).not.toContain('Start a guest thread')
})
