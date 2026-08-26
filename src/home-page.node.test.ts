import { expect, test } from 'vitest'
import { safetyNavLabel } from '#src/html.ts'
import { handleRequest } from '#src/index.ts'
import { publicPages } from '#src/site-pages.ts'
import {
	createSignedInUser,
	createTestEnv,
	request,
} from '#src/test-support.ts'

function navHtml(html: string) {
	return html.match(/<nav>([\s\S]*?)<\/nav>/)?.[1] ?? ''
}

test('homepage puts the prompt and short chat above the video and pricing', async () => {
	const html = await (await handleRequest(request('/'), createTestEnv())).text()
	expect(html).toContain('class="home-page"')
	expect(html).not.toContain('>Features</a>')
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
	expect(navHtml(html)).toContain('href="/docs"')
	expect(navHtml(html)).toContain('>Docs</a>')
	expect(html).toContain(
		'.home-hero { display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 2.2rem; align-items: stretch; }',
	)
	expect(html).toContain(
		'.demo-room { display: flex; flex-direction: column; height: 0; min-height: 100%; overflow: hidden;',
	)
	expect(html).toContain(
		'.demo-room .demo-chat { flex: 1 1 0; min-height: 0; height: auto; max-height: none; overflow-y: auto; margin: .8rem 0; }',
	)
	expect(html).toContain('.demo-room { height: 22rem; min-height: 0; }')
	expect(html).not.toContain(
		'.demo-chat, .demo-room .demo-chat { height: auto; overflow: visible; }',
	)
	expect(html).toContain('.chat-item[data-demo-hidden] { display: none; }')
	expect(html).toContain('.chat-item[data-demo-shown] { animation: bubble-in')
	expect(html).toContain(
		'.chat-item[data-demo-typing] { flex: 0 0 auto; width: max-content; }',
	)
	expect(html).toContain(
		'.chat-item[data-demo-typing] .bubble { flex: 0 0 auto; }',
	)
	expect(html).toContain("chat.querySelectorAll('.chat-item')")
	expect(html).toContain('function showTyping(bubble)')
	expect(html).toContain("item.dataset.demoTyping = ''")
	expect(html).toContain("querySelector('.agent-avatar')")
	expect(html).toContain('cloneNode(true)')
	expect(html).not.toContain("typing.className = 'bubble demo-typing'")
	expect(html).not.toContain('.demo-typing[data-mine]')
	expect(html).not.toContain('.bubble[data-demo-hidden]')
	expect(html).not.toContain('.bubble[data-demo-shown]')
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

test('signed-out public pages share Pricing, Docs, and safety in the nav', async () => {
	const env = createTestEnv()
	for (const page of publicPages) {
		const html = await (await handleRequest(request(page.path), env)).text()
		const nav = navHtml(html)
		expect(nav).toContain('>Pricing</a>')
		expect(nav).toContain('href="/docs"')
		expect(nav).toContain('>Docs</a>')
		expect(nav).toContain(`>${safetyNavLabel}<`)
		expect(nav).not.toContain('>Features</a>')
	}
})
