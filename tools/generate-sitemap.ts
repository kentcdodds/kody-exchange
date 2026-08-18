import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sitemapXml } from '../src/site-pages.ts'

const sitemapPath = join(
	dirname(fileURLToPath(import.meta.url)),
	'../public/sitemap.xml',
)
const xml = sitemapXml('https://kody.exchange')

if (process.argv.includes('--check')) {
	const current = readFileSync(sitemapPath, 'utf8')
	if (current !== xml) {
		console.error('public/sitemap.xml is stale. Run npm run generate:sitemap')
		process.exit(1)
	}
} else {
	mkdirSync(dirname(sitemapPath), { recursive: true })
	writeFileSync(sitemapPath, xml)
}
