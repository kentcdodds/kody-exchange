import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { handleRequest } from '#src/index.ts'
import {
	homepageDemoVideoId,
	homepageDemoVideoTitle,
	homepageDemoVideoWatchUrl,
	liteYoutubeEmbedCssPath,
	liteYoutubeEmbedJsPath,
} from '#src/homepage-demo-video.ts'
import { createTestEnv, request } from '#src/test-support.ts'

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '../public')

test('homepage embeds the demo with lite-youtube-embed', async () => {
	const home = await handleRequest(request('/'), createTestEnv())
	expect(home.status).toBe(200)
	const html = await home.text()
	expect(html).toContain('id="home-prompt"')
	expect(html).toContain(`<lite-youtube videoid="${homepageDemoVideoId}"`)
	expect(html).toContain(homepageDemoVideoTitle)
	expect(html).toContain(`href="${homepageDemoVideoWatchUrl}"`)
	expect(html).toContain(`href="${liteYoutubeEmbedCssPath}"`)
	expect(html).toContain(`src="${liteYoutubeEmbedJsPath}"`)
	expect(html).toContain('class="lyt-playbtn"')
	expect(html.indexOf('id="home-prompt"')).toBeLessThan(
		html.indexOf(`<lite-youtube videoid="${homepageDemoVideoId}"`),
	)
	expect(html.indexOf('room/ debugging-401s')).toBeLessThan(
		html.indexOf(`<lite-youtube videoid="${homepageDemoVideoId}"`),
	)
})

test('homepage markdown links the demo video', async () => {
	const markdown = await handleRequest(
		request('/', { headers: { accept: 'text/markdown' } }),
		createTestEnv(),
	)
	expect(markdown.status).toBe(200)
	const body = await markdown.text()
	expect(body).toContain(`[Watch the demo](${homepageDemoVideoWatchUrl})`)
	expect(body).toContain(homepageDemoVideoTitle)
})

test('vendored lite-youtube-embed files are the custom element', () => {
	const css = readFileSync(join(publicDir, 'lite-yt-embed.css'), 'utf8')
	const js = readFileSync(join(publicDir, 'lite-yt-embed.js'), 'utf8')
	expect(css).toContain('Apache License 2.0')
	expect(css).toContain('lite-youtube')
	expect(css).toContain('.lyt-playbtn')
	expect(js).toContain('Apache License 2.0')
	expect(js).toContain("customElements.define('lite-youtube', LiteYTEmbed)")
})
