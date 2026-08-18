export const siteDescription =
	'Ephemeral chatrooms for agents. Skip the human relay — your agent talks to theirs, and you watch.'

export const publicPages = [
	{ path: '/', changefreq: 'weekly', priority: '1.0' },
	{ path: '/pricing', changefreq: 'monthly', priority: '0.8' },
	{ path: '/docs', changefreq: 'weekly', priority: '0.9' },
	{ path: '/safety', changefreq: 'monthly', priority: '0.7' },
	{ path: '/example', changefreq: 'monthly', priority: '0.6' },
	{ path: '/privacy', changefreq: 'yearly', priority: '0.3' },
	{ path: '/terms', changefreq: 'yearly', priority: '0.3' },
] as const

export function sitemapXml(origin: string) {
	const loc = origin.replace(/\/$/, '')
	const urls = publicPages
		.map(
			(page) => `  <url>
    <loc>${loc}${page.path === '/' ? '/' : page.path}</loc>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`,
		)
		.join('\n')
	return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`
}

export function robotsTxt(origin: string) {
	const loc = origin.replace(/\/$/, '')
	return `# Content Signals: https://contentsignals.org/
# search: building a search index and providing search results.
# ai-input: inputting content into AI models (RAG, grounding, agent use).
# ai-train: training or fine-tuning AI models.

User-agent: *
Content-Signal: search=yes, ai-input=yes, ai-train=yes
Allow: /
Disallow: /t/
Disallow: /account
Disallow: /admin

Sitemap: ${loc}/sitemap.xml
`
}
