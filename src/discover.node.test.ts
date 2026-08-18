import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import {
	apiCatalogPath,
	authMdPath,
	jsonLdGraph,
	llmsTxtPath,
	mcpServerCardPath,
	prefersMarkdown,
	robotsTxt,
	sitemapXml,
} from '#src/discover.ts'
import { handleRequest } from '#src/index.ts'
import {
	createSignedInUser,
	createTestEnv,
	request,
} from '#src/test-support.ts'
import { publicPages } from '#src/site-pages.ts'

const origin = 'https://kody.exchange'

test('committed sitemap matches the generator and lists public pages', () => {
	const committed = readFileSync(
		join(dirname(fileURLToPath(import.meta.url)), '../public/sitemap.xml'),
		'utf8',
	)
	expect(committed).toBe(sitemapXml(origin))
	for (const page of publicPages) {
		expect(committed).toContain(
			`<loc>${origin}${page.path === '/' ? '/' : page.path}</loc>`,
		)
	}
})

test('robots.txt names the sitemap and Content Signals', async () => {
	const robots = await handleRequest(request('/robots.txt'), createTestEnv())
	expect(robots.status).toBe(200)
	expect(robots.headers.get('content-type')).toMatch(/text\/plain/)
	const text = await robots.text()
	expect(text).toBe(robotsTxt(origin))
	expect(text).toContain(`Sitemap: ${origin}/sitemap.xml`)
	expect(text).toContain(
		'Content-Signal: search=yes, ai-input=yes, ai-train=yes',
	)
	expect(text).toContain('Disallow: /t/')
})

test('sitemap.xml is valid XML at the site root', async () => {
	const sitemap = await handleRequest(request('/sitemap.xml'), createTestEnv())
	expect(sitemap.status).toBe(200)
	expect(sitemap.headers.get('content-type')).toMatch(/application\/xml/)
	expect(await sitemap.text()).toBe(sitemapXml(origin))
})

test('homepage HTML includes JSON-LD for the organisation and the product', async () => {
	const home = await handleRequest(request('/'), createTestEnv())
	expect(home.status).toBe(200)
	const html = await home.text()
	expect(html).toContain('type="application/ld+json"')
	const match = html.match(
		/<script type="application\/ld\+json">([^<]+)<\/script>/,
	)
	expect(match?.[1]).toBeTruthy()
	const graph = JSON.parse(match?.[1] ?? '{}') as ReturnType<typeof jsonLdGraph>
	const types = graph['@graph'].flatMap((node) =>
		Array.isArray(node['@type']) ? node['@type'] : [node['@type']],
	)
	expect(types).toContain('Organization')
	expect(types).toContain('SoftwareApplication')
	expect(types).toContain('WebApplication')
	expect(html).toContain('rel="canonical"')
	expect(html).toContain('width="140" height="140"')
	expect(html).toContain('fetchpriority="high"')
	expect(html).toContain('display=swap')
	expect(home.headers.get('link')).toContain('rel="api-catalog"')
	expect(home.headers.get('link')).toContain(apiCatalogPath)
})

test('public pages negotiate Markdown and expose discovery documents', async () => {
	expect(
		prefersMarkdown(
			new Request(origin, { headers: { accept: 'text/markdown' } }),
		),
	).toBe(true)
	expect(
		prefersMarkdown(new Request(origin, { headers: { accept: 'text/html' } })),
	).toBe(false)
	expect(
		prefersMarkdown(
			new Request(origin, {
				headers: { accept: 'text/html;q=1, text/markdown;q=0' },
			}),
		),
	).toBe(false)
	expect(
		prefersMarkdown(
			new Request(origin, {
				headers: { accept: 'text/markdown;q=0.1, text/html;q=0.9' },
			}),
		),
	).toBe(false)
	expect(
		prefersMarkdown(
			new Request(origin, {
				headers: { accept: 'text/html;q=0.1, text/markdown;q=0.9' },
			}),
		),
	).toBe(true)

	const markdown = await handleRequest(
		request('/', { headers: { accept: 'text/markdown' } }),
		createTestEnv(),
	)
	expect(markdown.status).toBe(200)
	expect(markdown.headers.get('content-type')).toMatch(/text\/markdown/)
	const body = await markdown.text()
	expect(body).toContain('# Ephemeral chatrooms for agents.')
	expect(body).toContain('POST https://kody.exchange/v1/threads')

	const env = createTestEnv()
	const llms = await handleRequest(request(llmsTxtPath), env)
	expect(llms.status).toBe(200)
	expect(await llms.text()).toContain('## API')

	const auth = await handleRequest(request(authMdPath), env)
	expect(auth.status).toBe(200)
	expect(await auth.text()).toContain('OAuth 2.1')

	const catalog = await handleRequest(request(apiCatalogPath), env)
	expect(catalog.status).toBe(200)
	expect(catalog.headers.get('content-type')).toMatch(
		/application\/linkset\+json/,
	)
	const catalogJson = (await catalog.json()) as {
		linkset: Array<{ anchor: string }>
	}
	expect(catalogJson.linkset.map((entry) => entry.anchor)).toEqual([
		`${origin}/v1/threads`,
		`${origin}/api/`,
		`${origin}/mcp`,
	])

	const card = await handleRequest(request(mcpServerCardPath), env)
	expect(card.status).toBe(200)
	const cardJson = (await card.json()) as {
		name: string
		remotes: Array<{ url: string }>
	}
	expect(cardJson.name).toBe('kody.exchange/mcp')
	expect(cardJson.remotes[0]?.url).toBe(`${origin}/mcp`)
})

test('discovery headers stay on public pages and follow APP_BASE_URL', async () => {
	const env = createTestEnv({ APP_BASE_URL: 'https://preview.example.test' })
	const home = await handleRequest(request('/'), env)
	expect(home.headers.get('link')).toContain(
		'https://preview.example.test/.well-known/api-catalog',
	)
	expect(home.headers.get('content-signal')).toContain('ai-train=yes')

	const { cookie } = await createSignedInUser(env)
	const account = await handleRequest(
		request('/account', { headers: { cookie } }),
		env,
	)
	expect(account.status).toBe(200)
	expect(account.headers.get('link') ?? '').not.toContain('rel="api-catalog"')
	expect(account.headers.get('content-signal')).toBeNull()
})
